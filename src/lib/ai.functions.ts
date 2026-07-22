import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTemplateOrgId } from "@/lib/org-helpers";
import { generateReply } from "./ai.server";
import { triggerFlows } from "./flow-trigger.server";

async function getUserOrg(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("No organization");
  return data.org_id;
}

const DEFAULT_CFG = {
  enabled: false,
  provider: "" as const,
  selected_provider: "" as const,
  fallback_provider: "none" as const,
  model: "gpt-4o-mini",
  system_prompt: "Eres un asistente de ventas amable y conciso. Responde en español.",
  knowledge_base: "",
  respond_to: "all" as const,
  vertex_project: "",
  vertex_location: "us-central1",
  vertex_model: "gemini-2.5-flash",
  openai_api_key: "",
  grok_api_key: "",
  vertex_service_account_json: "",
};

async function getAiConfigForOrg(orgId: string) {
  const { data } = await supabaseAdmin
    .from("ai_configs")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();

  if (data) return data;

  const templateOrgId = await getTemplateOrgId();
  if (!templateOrgId || templateOrgId === orgId) return null;

  const { data: templateConfig } = await supabaseAdmin
    .from("ai_configs")
    .select("*")
    .eq("org_id", templateOrgId)
    .maybeSingle();

  if (!templateConfig) return null;
  return { ...templateConfig, org_id: orgId };
}

export const getAiConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const data = await getAiConfigForOrg(orgId);
    const hasVertexSecret = !!(data?.vertex_service_account_json || process.env.VERTEX_SERVICE_ACCOUNT_JSON);
    return { config: data ?? { org_id: orgId, ...DEFAULT_CFG }, hasVertexSecret };
  });

const SaveSchema = z.object({
  enabled: z.boolean(),
  provider: z.string().min(0),
  selected_provider: z.string().optional(),
  fallback_provider: z.enum(["lovable", "vertex", "openai", "grok", "none"]).nullable().optional(),
  model: z.string().min(1).max(100),
  system_prompt: z.string().max(8000),
  knowledge_base: z.string().max(50000),
  respond_to: z.enum(["all", "new"]),
  vertex_project: z.string().max(100).nullable().optional(),
  vertex_location: z.string().max(50).nullable().optional(),
  vertex_model: z.string().max(100).nullable().optional(),
  openai_api_key: z.string().max(500).nullable().optional(),
  grok_api_key: z.string().max(500).nullable().optional(),
  vertex_service_account_json: z.string().max(20000).nullable().optional(),
});

export const saveAiConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SaveSchema.parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("ai_configs")
      .upsert({ org_id: orgId, ...data, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testAiReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ message: z.string().min(1).max(2000) }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: cfg } = await supabaseAdmin
      .from("ai_configs")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle();
    if (!cfg) throw new Error("Configura la IA primero");
    const reply = await generateReply(cfg as any, data.message);
    return { reply };
  });

export const listAiActions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: logs, error } = await supabaseAdmin
      .from("ai_actions_log")
      .select("id, action_name, action_details, created_at")
      .eq("org_id", orgId)
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { logs: (logs ?? []) as Array<{ id: string; action_name: string; action_details: string; created_at: string }> };
  });

// === RESPALDO DEL APRENDIZAJE DE LA IA (export / import) ===
// Permite descargar todo lo que la IA aprendio de los clientes (contacts.ai_memory)
// a un archivo JSON, y volver a cargarlo en otro equipo/entorno. El dato "vivo"
// sigue en Supabase (pesa poquisimo); esto es respaldo y portabilidad.

export const exportAiLearning = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("id, wa_id, phone, display_name, ai_memory")
      .eq("org_id", orgId)
      .not("ai_memory", "is", null);
    if (error) throw new Error(error.message);

    const contacts = (data ?? []).filter((c: any) => {
      const m = c.ai_memory;
      if (!m || typeof m !== "object") return false;
      return Object.keys(m).length > 0 && JSON.stringify(m) !== "{}";
    });

    return {
      version: 1 as const,
      kind: "ai-learning-backup" as const,
      exported_at: new Date().toISOString(),
      org_id: orgId,
      count: contacts.length,
      contacts: contacts.map((c: any) => ({
        contact_id: c.id as string,
        wa_id: (c.wa_id ?? null) as string | null,
        phone: (c.phone ?? null) as string | null,
        display_name: (c.display_name ?? null) as string | null,
        ai_memory: c.ai_memory,
      })),
    };
  });

const ImportSchema = z.object({
  version: z.number().optional(),
  kind: z.string().optional(),
  contacts: z
    .array(
      z.object({
        contact_id: z.string().uuid().optional().nullable(),
        wa_id: z.string().max(128).optional().nullable(),
        ai_memory: z.record(z.any()),
      }),
    )
    .max(100000),
});

export const importAiLearning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ImportSchema.parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const nowStr = new Date().toISOString();

    let updated = 0;
    let skipped = 0;

    // Se procesa en lotes pequenos para no saturar la conexion.
    for (let i = 0; i < data.contacts.length; i += 25) {
      const chunk = data.contacts.slice(i, i + 25);
      await Promise.all(
        chunk.map(async (entry) => {
          try {
            let query = supabaseAdmin
              .from("contacts")
              .update({ ai_memory: entry.ai_memory, updated_at: nowStr })
              .eq("org_id", orgId);

            if (entry.contact_id) {
              query = query.eq("id", entry.contact_id);
            } else if (entry.wa_id) {
              query = query.eq("wa_id", entry.wa_id);
            } else {
              skipped++;
              return;
            }

            const { data: res, error } = await query.select("id");
            if (error || !res || res.length === 0) {
              skipped++;
            } else {
              updated += res.length;
            }
          } catch {
            skipped++;
          }
        }),
      );
    }

    return { ok: true, updated, skipped, total: data.contacts.length };
  });

export const toggleContactAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid(), contactId: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("threads")
      .update({ ai_enabled: data.enabled })
      .eq("id", data.threadId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    
    // Disparar flujos (ai_enabled / ai_disabled)
    const triggerType = data.enabled ? "ai_enabled" : "ai_disabled";
    triggerFlows({ orgId, contactId: data.contactId, triggerType }).catch(console.error);
    
    return { success: true };
  });
