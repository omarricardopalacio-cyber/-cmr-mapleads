import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateReply } from "./ai.server";

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
  provider: "lovable" as const,
  model: "google/gemini-2.5-flash",
  system_prompt: "Eres un asistente de ventas amable y conciso. Responde en español.",
  knowledge_base: "",
  respond_to: "all" as const,
  vertex_project: "",
  vertex_location: "us-central1",
  vertex_model: "gemini-2.5-flash",
};

export const getAiConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await supabaseAdmin
      .from("ai_configs")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle();
    const hasVertexSecret = !!process.env.VERTEX_SERVICE_ACCOUNT_JSON;
    return { config: data ?? { org_id: orgId, ...DEFAULT_CFG }, hasVertexSecret };
  });

const SaveSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["lovable", "vertex"]),
  model: z.string().min(1).max(100),
  system_prompt: z.string().max(8000),
  knowledge_base: z.string().max(50000),
  respond_to: z.enum(["all", "new"]),
  vertex_project: z.string().max(100).nullable().optional(),
  vertex_location: z.string().max(50).nullable().optional(),
  vertex_model: z.string().max(100).nullable().optional(),
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
