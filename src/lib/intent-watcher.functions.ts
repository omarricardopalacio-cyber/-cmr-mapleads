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

export type AdSegmentStats = {
  contacts: number;
  messages_in: number;
  sales: number;
  cost_per_message: number | null;
  cost_per_sale: number | null;
  messages_per_sale: number | null;
};

function calcSegmentMetrics(investment: number, messagesIn: number, sales: number): Omit<AdSegmentStats, "contacts" | "messages_in" | "sales"> {
  const inv = Number(investment) || 0;
  return {
    cost_per_message: messagesIn > 0 ? inv / messagesIn : null,
    cost_per_sale: sales > 0 ? inv / sales : null,
    messages_per_sale: sales > 0 ? messagesIn / sales : null,
  };
}

async function loadSegmentStats(
  orgId: string,
  segmentIds: string[],
): Promise<Record<string, { contacts: number; messages_in: number; sales: number }>> {
  const out: Record<string, { contacts: number; messages_in: number; sales: number }> = {};
  for (const id of segmentIds) {
    out[id] = { contacts: 0, messages_in: 0, sales: 0 };
  }
  if (!segmentIds.length) return out;

  const { data: contacts } = await db()
    .from("contacts")
    .select("id, entry_segment_id")
    .eq("org_id", orgId)
    .in("entry_segment_id", segmentIds);

  const bySegment = new Map<string, string[]>();
  for (const c of contacts ?? []) {
    const sid = c.entry_segment_id as string;
    if (!sid) continue;
    if (!bySegment.has(sid)) bySegment.set(sid, []);
    bySegment.get(sid)!.push(c.id as string);
    if (out[sid]) out[sid].contacts += 1;
  }

  const allContactIds = (contacts ?? []).map((c: any) => c.id as string);
  if (!allContactIds.length) return out;

  const contactToSegment = new Map<string, string>();
  for (const c of contacts ?? []) {
    if (c.entry_segment_id) contactToSegment.set(c.id, c.entry_segment_id);
  }

  // Mensajes entrantes (recibidos) de contactos de cada segmento
  const { data: threads } = await db()
    .from("threads")
    .select("id, contact_id")
    .eq("org_id", orgId)
    .in("contact_id", allContactIds);

  const threadToSegment = new Map<string, string>();
  for (const t of threads ?? []) {
    const sid = contactToSegment.get(t.contact_id as string);
    if (sid) threadToSegment.set(t.id as string, sid);
  }

  const threadIds = (threads ?? []).map((t: any) => t.id as string);
  if (threadIds.length) {
    // Contar por lotes si hay muchos hilos
    const chunk = 200;
    for (let i = 0; i < threadIds.length; i += chunk) {
      const slice = threadIds.slice(i, i + chunk);
      const { data: msgs } = await db()
        .from("messages")
        .select("thread_id")
        .eq("direction", "in")
        .in("thread_id", slice);
      for (const m of msgs ?? []) {
        const sid = threadToSegment.get(m.thread_id as string);
        if (sid && out[sid]) out[sid].messages_in += 1;
      }
    }
  }

  // Ventas consolidadas: contactos del segmento con al menos un pedido
  const { data: orders } = await db()
    .from("orders")
    .select("contact_id")
    .eq("org_id", orgId)
    .in("contact_id", allContactIds)
    .not("contact_id", "is", null);

  const soldContacts = new Set<string>();
  for (const o of orders ?? []) {
    if (o.contact_id) soldContacts.add(o.contact_id as string);
  }
  for (const contactId of soldContacts) {
    const sid = contactToSegment.get(contactId);
    if (sid && out[sid]) out[sid].sales += 1;
  }

  return out;
}

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

    const items = data ?? [];
    const ids = items.map((s: any) => s.id as string);
    let statsMap: Record<string, { contacts: number; messages_in: number; sales: number }> = {};
    try {
      statsMap = await loadSegmentStats(orgId, ids);
    } catch (e: any) {
      console.warn("[listAdSegments] stats:", e?.message);
    }

    return {
      items: items.map((s: any) => {
        const st = statsMap[s.id] ?? { contacts: 0, messages_in: 0, sales: 0 };
        const metrics = calcSegmentMetrics(Number(s.ad_investment) || 0, st.messages_in, st.sales);
        return {
          ...s,
          stats: {
            contacts: st.contacts,
            messages_in: st.messages_in,
            sales: st.sales,
            ...metrics,
          } satisfies AdSegmentStats,
        };
      }),
    };
  });

const AdSegmentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  match_phrase: z.string().min(1).max(500),
  match_mode: z.enum(["contains", "equals", "starts"]).default("contains"),
  flow_id: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(0).max(10000).default(100),
  is_active: z.boolean().default(true),
  observations: z.string().max(5000).nullable().optional(),
  ad_investment: z.number().min(0).max(1_000_000_000).default(0),
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
      observations: data.observations?.trim() || null,
      ad_investment: data.ad_investment ?? 0,
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
