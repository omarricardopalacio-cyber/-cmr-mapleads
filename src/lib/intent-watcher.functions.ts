import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "@/lib/org-helpers";

async function getUserOrg(userId: string) {
  return ensureUserOrg(userId);
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

// ── Barridos del vigilante (uno a uno, salta si ya está hecho) ──

async function loadInboundTextForContact(
  orgId: string,
  contactId: string,
  maxMsgs = 12,
): Promise<{ text: string; threadId: string | null }> {
  const { data: threads } = await db()
    .from("threads")
    .select("id")
    .eq("org_id", orgId)
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false })
    .limit(3);

  const threadIds = (threads ?? []).map((t: any) => t.id as string);
  if (!threadIds.length) return { text: "", threadId: null };

  const { data: msgs } = await db()
    .from("messages")
    .select("thread_id, text, created_at")
    .eq("direction", "in")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: true })
    .limit(maxMsgs);

  const parts: string[] = [];
  for (const m of msgs ?? []) {
    const t = String((m as any).text || "").trim();
    if (t) parts.push(t);
  }
  return {
    text: parts.join("\n").slice(0, 4000),
    threadId: threadIds[0] ?? null,
  };
}

const ScanBatchSchema = z.object({
  limit: z.number().int().min(1).max(80).default(40),
  offset: z.number().int().min(0).max(100000).default(0),
});

/**
 * Recorre chats sin segmento y aplica Segmentos de publicidad si hay match.
 * Si ya tiene entry_segment_id → salta (no cuenta como aplicado).
 */
export const scanAdSegmentsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ScanBatchSchema.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { applyEntrySegmentToContact } = await import("@/lib/ad-segments.server");
    const { ensureContactTag } = await import("@/lib/contact-tag.server");

    const orgId = await getUserOrg(context.userId);
    const limit = data.limit;
    const offset = data.offset;

    const { data: contacts, error } = await db()
      .from("contacts")
      .select("id, display_name, entry_segment_id")
      .eq("org_id", orgId)
      .is("entry_segment_id", null)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);

    const batch = contacts ?? [];
    let scanned = 0;
    let applied = 0;
    let skipped = 0;
    const samples: string[] = [];

    for (const c of batch) {
      scanned += 1;
      if ((c as any).entry_segment_id) {
        skipped += 1;
        continue;
      }
      const { text } = await loadInboundTextForContact(orgId, c.id as string);
      if (!text.trim()) {
        skipped += 1;
        continue;
      }
      const result = await applyEntrySegmentToContact({
        orgId,
        contactId: c.id as string,
        text,
        force: false,
      });
      if (result.applied && result.segment) {
        applied += 1;
        await ensureContactTag({
          orgId,
          contactId: c.id as string,
          tagName: result.segment.name,
          color: "#a855f7",
        });
        if (samples.length < 5) {
          samples.push(`${(c as any).display_name || c.id} → ${result.segment.name}`);
        }
      } else {
        skipped += 1;
      }
    }

    const done = batch.length < limit;
    return {
      ok: true,
      scanned,
      applied,
      skipped,
      done,
      nextOffset: done ? offset + batch.length : offset + limit,
      samples,
    };
  });

/**
 * Recorre chats sin flujo activo / sin intención y clasifica + asigna flujo.
 * Si ya tiene flujo activo o ya se registró la misma intención → salta.
 */
export const scanIntentFlowsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ScanBatchSchema.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { runIntentWatcher } = await import("@/lib/intent-watcher.server");

    const orgId = await getUserOrg(context.userId);
    const limit = data.limit;
    const offset = data.offset;

    // Candidatos: sin last_intent_key o sin last_watcher_flow_id
    const { data: contacts, error } = await db()
      .from("contacts")
      .select("id, display_name, last_intent_key, last_watcher_flow_id")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);

    const batch = contacts ?? [];
    const contactIds = batch.map((c: any) => c.id as string);

    const activeByContact = new Set<string>();
    if (contactIds.length) {
      const { data: runs } = await db()
        .from("flow_runs")
        .select("contact_id")
        .eq("org_id", orgId)
        .in("contact_id", contactIds)
        .in("status", ["active", "running", "wait_node", "paused"]);
      for (const r of runs ?? []) {
        if (r.contact_id) activeByContact.add(r.contact_id as string);
      }
    }

    let scanned = 0;
    let applied = 0;
    let skipped = 0;
    const samples: string[] = [];

    for (const c of batch) {
      scanned += 1;
      const cid = c.id as string;

      // Ya tiene flujo activo → no tocar
      if (activeByContact.has(cid)) {
        skipped += 1;
        continue;
      }

      // Ya clasificado e intentó asignar flujo → saltar (dejar por sentado)
      if ((c as any).last_intent_key && (c as any).last_watcher_flow_id) {
        skipped += 1;
        continue;
      }

      const { text, threadId } = await loadInboundTextForContact(orgId, cid, 20);
      if (!text.trim()) {
        skipped += 1;
        continue;
      }

      const result = await runIntentWatcher({
        orgId,
        contactId: cid,
        threadId,
        text,
        trigger: "message",
        skipFlowStart: false,
      });

      // Contar solo si hubo clasificación o arranque de flujo (no si no hizo nada)
      const noopSkips = new Set([
        "cooldown",
        "mismo_flujo_activo",
        "vigilante_apagado",
        "sin_reglas",
        "sin_match",
        "contacto_no_encontrado",
      ]);
      if (result.started || (result.intent_key && !noopSkips.has(String(result.skipped || "")))) {
        applied += 1;
        if (samples.length < 5) {
          samples.push(
            `${(c as any).display_name || cid} → ${result.intent_key}${result.started ? " (flujo)" : ""}`,
          );
        }
      } else {
        skipped += 1;
      }
    }

    const done = batch.length < limit;
    return {
      ok: true,
      scanned,
      applied,
      skipped,
      done,
      nextOffset: done ? offset + batch.length : offset + limit,
      samples,
    };
  });

/**
 * Rellena Productos consultados + Preguntas desde el historial del chat.
 * Omite contactos que ya tienen ambos campos.
 */
export const scanInquiryBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ScanBatchSchema.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const {
      backfillContactInquiryFromChat,
      loadInquiryProductCatalog,
    } = await import("@/lib/contact-inquiry.server");

    const orgId = await getUserOrg(context.userId);
    const limit = data.limit;
    const offset = data.offset;
    const catalog = await loadInquiryProductCatalog(orgId);

    const { data: contacts, error } = await db()
      .from("contacts")
      .select("id, display_name, phone, asked_products, asked_questions")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);

    const batch = contacts ?? [];
    let scanned = 0;
    let applied = 0;
    let skipped = 0;
    let productsAdded = 0;
    let questionsAdded = 0;
    const samples: string[] = [];

    for (const c of batch) {
      scanned += 1;
      const hasProducts = String((c as any).asked_products || "").trim().length > 0;
      const hasQuestions = String((c as any).asked_questions || "").trim().length > 0;
      if (hasProducts && hasQuestions) {
        skipped += 1;
        continue;
      }

      const result = await backfillContactInquiryFromChat({
        orgId,
        contactId: c.id as string,
        catalog,
        maxMsgs: 40,
      });

      if (result.skipped || (result.productsAdded === 0 && result.questionsAdded === 0)) {
        skipped += 1;
      } else {
        applied += 1;
        productsAdded += result.productsAdded;
        questionsAdded += result.questionsAdded;
        if (samples.length < 5) {
          const label = (c as any).display_name || (c as any).phone || c.id;
          samples.push(
            `${label}: +${result.productsAdded} prod, +${result.questionsAdded} preg`,
          );
        }
      }
    }

    const done = batch.length < limit;
    return {
      ok: true,
      scanned,
      applied,
      skipped,
      productsAdded,
      questionsAdded,
      done,
      nextOffset: done ? offset + batch.length : offset + limit,
      samples,
    };
  });
