import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

const db = () => supabaseAdmin as unknown as { from: (t: string) => any };

export const getWatcherConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await db()
      .from("watcher_configs")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle();
    return {
      config: data ?? {
        org_id: orgId,
        enabled: false,
        grok_api_key: "",
        model: "llama-3.3-70b-versatile",
        extract_profile: true,
      },
    };
  });

export const saveWatcherConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        enabled: z.boolean(),
        grok_api_key: z.string().max(500).nullable().optional(),
        model: z.string().min(1).max(100),
        extract_profile: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { error } = await db()
      .from("watcher_configs")
      .upsert({
        org_id: orgId,
        enabled: data.enabled,
        grok_api_key: data.grok_api_key || null,
        model: data.model,
        extract_profile: data.extract_profile,
        updated_at: new Date().toISOString(),
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listIntentRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data, error } = await db()
      .from("intent_rules")
      .select("*, flows:flow_id(id, name)")
      .eq("org_id", orgId)
      .order("priority", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

const IntentRuleSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  intent_key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_]+$/, "Usa solo minúsculas, números y _ (ej: precio_caro)"),
  description: z.string().max(1000).nullable().optional(),
  match_type: z.enum(["keywords", "ai", "both"]).default("both"),
  keywords: z.string().max(4000).nullable().optional(),
  trigger_on: z.enum(["message", "no_response", "purchase", "any"]).default("message"),
  flow_id: z.string().uuid(),
  priority: z.number().int().min(0).max(10000).default(100),
  cooldown_seconds: z.number().int().min(0).max(2592000).default(300),
  is_active: z.boolean().default(true),
});

export const upsertIntentRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IntentRuleSchema.parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const payload = {
      org_id: orgId,
      name: data.name,
      intent_key: data.intent_key.trim().toLowerCase(),
      description: data.description ?? null,
      match_type: data.match_type,
      keywords: data.keywords ?? null,
      trigger_on: data.trigger_on,
      flow_id: data.flow_id,
      priority: data.priority,
      cooldown_seconds: data.cooldown_seconds,
      is_active: data.is_active,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { data: row, error } = await db()
        .from("intent_rules")
        .update(payload)
        .eq("id", data.id)
        .eq("org_id", orgId)
        .select("*, flows:flow_id(id, name)")
        .single();
      if (error) throw new Error(error.message);
      return { item: row };
    }

    const { data: row, error } = await db()
      .from("intent_rules")
      .insert(payload)
      .select("*, flows:flow_id(id, name)")
      .single();
    if (error) throw new Error(error.message);
    return { item: row };
  });

export const deleteIntentRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { error } = await db()
      .from("intent_rules")
      .delete()
      .eq("id", data.id)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ───── SEGMENTOS DE ENTRADA (Facebook / publicidad) ─────

export const listAdSegments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data, error } = await db()
      .from("ad_segments")
      .select("*, flows:flow_id(id, name)")
      .eq("org_id", orgId)
      .order("priority", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

const AdSegmentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  match_phrase: z.string().min(1).max(500),
  match_mode: z.enum(["contains", "equals", "starts"]).default("contains"),
  flow_id: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(0).max(10000).default(100),
  is_active: z.boolean().default(true),
});

export const upsertAdSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => AdSegmentSchema.parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const payload = {
      org_id: orgId,
      name: data.name.trim(),
      match_phrase: data.match_phrase.trim(),
      match_mode: data.match_mode,
      flow_id: data.flow_id || null,
      priority: data.priority,
      is_active: data.is_active,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { data: row, error } = await db()
        .from("ad_segments")
        .update(payload)
        .eq("id", data.id)
        .eq("org_id", orgId)
        .select("*, flows:flow_id(id, name)")
        .single();
      if (error) throw new Error(error.message);
      return { item: row };
    }

    const { data: row, error } = await db()
      .from("ad_segments")
      .insert(payload)
      .select("*, flows:flow_id(id, name)")
      .single();
    if (error) throw new Error(error.message);
    return { item: row };
  });

export const deleteAdSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { error } = await db()
      .from("ad_segments")
      .delete()
      .eq("id", data.id)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
