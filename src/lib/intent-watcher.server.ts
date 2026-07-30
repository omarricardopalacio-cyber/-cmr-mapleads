/**
 * Vigilante de intenciones — IA aparte (Groq propio).
 * No habla con el cliente ni crea citas: solo actualiza ficha interna
 * y asigna el flujo correcto (cancelando los anteriores activos).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { startWatcherFlowForContact } from "@/lib/flow-trigger.server";

export type WatcherTrigger = "message" | "no_response" | "purchase";

export type IntentRuleRow = {
  id: string;
  org_id: string;
  name: string;
  intent_key: string;
  description: string | null;
  match_type: "keywords" | "ai" | "both";
  keywords: string | null;
  trigger_on: WatcherTrigger | "any";
  flow_id: string;
  priority: number;
  cooldown_seconds: number;
  is_active: boolean;
};

type WatcherConfig = {
  enabled: boolean;
  grok_api_key: string | null;
  model: string;
  extract_profile: boolean;
};

type ProfilePatch = {
  display_name?: string | null;
  city?: string | null;
  address?: string | null;
  neighborhood?: string | null;
};

function normalize(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKeywords(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(/\r?\n|,/)
    .map((k) => normalize(k))
    .filter((k) => k.length >= 2);
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  if (!keywords.length) return false;
  const hay = normalize(text);
  return keywords.some((k) => hay.includes(k));
}

async function loadWatcherConfig(orgId: string): Promise<WatcherConfig> {
  const { data } = await (supabaseAdmin as any)
    .from("watcher_configs")
    .select("enabled, grok_api_key, model, extract_profile")
    .eq("org_id", orgId)
    .maybeSingle();
  return {
    enabled: !!data?.enabled,
    grok_api_key: (data?.grok_api_key as string) || process.env.WATCHER_GROQ_API_KEY || null,
    model: (data?.model as string) || "llama-3.3-70b-versatile",
    extract_profile: data?.extract_profile !== false,
  };
}

async function loadActiveRules(
  orgId: string,
  trigger: WatcherTrigger,
): Promise<IntentRuleRow[]> {
  const { data, error } = await (supabaseAdmin as any)
    .from("intent_rules")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("priority", { ascending: false });
  if (error) {
    console.warn("[watcher] load rules:", error.message);
    return [];
  }
  return ((data ?? []) as IntentRuleRow[]).filter(
    (r) => r.trigger_on === "any" || r.trigger_on === trigger,
  );
}

function pickByKeywords(
  text: string,
  rules: IntentRuleRow[],
): IntentRuleRow | null {
  const candidates = rules
    .filter((r) => r.match_type === "keywords" || r.match_type === "both")
    .filter((r) => matchesKeywords(text, parseKeywords(r.keywords)))
    .sort((a, b) => b.priority - a.priority);
  return candidates[0] ?? null;
}

async function classifyWithGroq(params: {
  apiKey: string;
  model: string;
  text: string;
  rules: IntentRuleRow[];
  extractProfile: boolean;
}): Promise<{ intent_key: string | null; profile: ProfilePatch }> {
  const catalog = params.rules.map((r) => ({
    intent_key: r.intent_key,
    name: r.name,
    description: r.description || "",
    keywords: parseKeywords(r.keywords).slice(0, 8),
  }));

  const system = `Eres un clasificador silencioso de CRM. NO hablas con el cliente.
Debes devolver SOLO JSON válido (sin markdown) con esta forma:
{"intent_key":"<clave o null>","nombre":null,"ciudad":null,"direccion":null,"barrio":null}
Reglas:
- intent_key debe ser una de las claves del catálogo, o null si ninguna encaja.
- Solo rellena nombre/ciudad/direccion/barrio si el mensaje los menciona claramente.
- No inventes datos.`;

  const user = `Catálogo de intenciones:\n${JSON.stringify(catalog)}\n\nMensaje del cliente:\n${params.text.slice(0, 1500)}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Watcher Groq ${res.status}: ${t.slice(0, 200)}`);
  }

  const j: any = await res.json();
  const raw = String(j?.choices?.[0]?.message?.content || "").trim();
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { intent_key: null, profile: {} };
  }

  const key = typeof parsed.intent_key === "string" ? parsed.intent_key.trim() : null;
  const validKeys = new Set(params.rules.map((r) => r.intent_key));
  const intent_key = key && validKeys.has(key) ? key : null;

  const profile: ProfilePatch = {};
  if (params.extractProfile) {
    if (typeof parsed.nombre === "string" && parsed.nombre.trim()) {
      profile.display_name = parsed.nombre.trim().slice(0, 120);
    }
    if (typeof parsed.ciudad === "string" && parsed.ciudad.trim()) {
      profile.city = parsed.ciudad.trim().slice(0, 120);
    }
    if (typeof parsed.direccion === "string" && parsed.direccion.trim()) {
      profile.address = parsed.direccion.trim().slice(0, 240);
    }
    if (typeof parsed.barrio === "string" && parsed.barrio.trim()) {
      profile.neighborhood = parsed.barrio.trim().slice(0, 120);
    }
  }

  return { intent_key, profile };
}

async function applyProfilePatch(contactId: string, patch: ProfilePatch) {
  const updates: Record<string, string> = {};
  if (patch.display_name) updates.display_name = patch.display_name;
  if (patch.city) updates.city = patch.city;
  if (patch.address) updates.address = patch.address;
  if (patch.neighborhood) updates.neighborhood = patch.neighborhood;
  if (!Object.keys(updates).length) return;
  updates.updated_at = new Date().toISOString();
  const { error } = await supabaseAdmin.from("contacts").update(updates).eq("id", contactId);
  if (error) console.warn("[watcher] profile update:", error.message);
}

function inCooldown(
  lastIntentKey: string | null | undefined,
  lastIntentAt: string | null | undefined,
  rule: IntentRuleRow,
): boolean {
  if (!lastIntentKey || lastIntentKey !== rule.intent_key) return false;
  if (!lastIntentAt) return false;
  const cool = Math.max(0, rule.cooldown_seconds || 0) * 1000;
  if (cool <= 0) return false;
  return Date.now() - new Date(lastIntentAt).getTime() < cool;
}

/**
 * Ejecuta el vigilante: detecta intención, actualiza ficha y asigna SOLO el último flujo.
 * No crea citas. Seguro llamarlo en fire-and-forget desde ingest.
 */
export async function runIntentWatcher(params: {
  orgId: string;
  contactId: string;
  threadId?: string | null;
  text?: string | null;
  trigger: WatcherTrigger;
  /** Forzar una intención (ej. purchase → compro) sin clasificar texto */
  forcedIntentKey?: string | null;
}): Promise<{
  ok: boolean;
  intent_key?: string | null;
  flow_id?: string | null;
  started?: boolean;
  skipped?: string;
}> {
  const { orgId, contactId, trigger } = params;
  const text = String(params.text || "").trim();

  try {
    const config = await loadWatcherConfig(orgId);
    if (!config.enabled) return { ok: true, skipped: "vigilante_apagado" };

    const rules = await loadActiveRules(orgId, trigger);
    if (!rules.length) return { ok: true, skipped: "sin_reglas" };

    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, display_name, city, address, neighborhood, last_intent_key, last_intent_at, last_watcher_flow_id")
      .eq("id", contactId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (!contact) return { ok: false, skipped: "contacto_no_encontrado" };

    let chosen: IntentRuleRow | null = null;
    let profile: ProfilePatch = {};

    if (params.forcedIntentKey) {
      chosen =
        rules.find((r) => r.intent_key === params.forcedIntentKey) ??
        rules.find((r) => r.intent_key === "compro" && trigger === "purchase") ??
        null;
    } else if (trigger === "no_response") {
      chosen =
        rules.find((r) => r.intent_key === "no_responde") ??
        rules.filter((r) => r.trigger_on === "no_response" || r.trigger_on === "any")
          .sort((a, b) => b.priority - a.priority)[0] ??
        null;
    } else if (text) {
      // 1) Keywords primero (barato y determinista)
      chosen = pickByKeywords(text, rules);

      // 2) IA vigilante (Groq propio) si hace falta
      const needsAi =
        !chosen &&
        config.enabled &&
        !!config.grok_api_key &&
        rules.some((r) => r.match_type === "ai" || r.match_type === "both");

      if (needsAi || (config.enabled && config.extract_profile && config.grok_api_key)) {
        const aiRules = rules.filter(
          (r) => r.match_type === "ai" || r.match_type === "both",
        );
        if (config.grok_api_key && (needsAi || config.extract_profile)) {
          try {
            const ai = await classifyWithGroq({
              apiKey: config.grok_api_key,
              model: config.model,
              text,
              rules: aiRules.length ? aiRules : rules,
              extractProfile: config.extract_profile,
            });
            profile = ai.profile;
            if (!chosen && ai.intent_key) {
              chosen = rules.find((r) => r.intent_key === ai.intent_key) ?? null;
            }
          } catch (err) {
            console.warn("[watcher] classify:", (err as Error)?.message);
          }
        }
      }
    }

    if (Object.keys(profile).length) {
      await applyProfilePatch(contactId, profile);
    }

    if (!chosen) return { ok: true, skipped: "sin_match", intent_key: null };

    if (
      inCooldown(
        (contact as any).last_intent_key,
        (contact as any).last_intent_at,
        chosen,
      )
    ) {
      return {
        ok: true,
        skipped: "cooldown",
        intent_key: chosen.intent_key,
        flow_id: chosen.flow_id,
      };
    }

    // Misma intención + mismo flujo ya activo → no reiniciar
    if (
      (contact as any).last_intent_key === chosen.intent_key &&
      (contact as any).last_watcher_flow_id === chosen.flow_id
    ) {
      const { data: activeSame } = await supabaseAdmin
        .from("flow_runs")
        .select("id")
        .eq("org_id", orgId)
        .eq("contact_id", contactId)
        .eq("flow_id", chosen.flow_id)
        .in("status", ["active", "running", "wait_node", "paused"])
        .maybeSingle();
      if (activeSame) {
        return {
          ok: true,
          skipped: "mismo_flujo_activo",
          intent_key: chosen.intent_key,
          flow_id: chosen.flow_id,
        };
      }
    }

    const result = await startWatcherFlowForContact({
      orgId,
      contactId,
      flowId: chosen.flow_id,
    });

    const now = new Date().toISOString();
    await supabaseAdmin
      .from("contacts")
      .update({
        last_intent_key: chosen.intent_key,
        last_intent_at: now,
        last_watcher_flow_id: chosen.flow_id,
        updated_at: now,
      } as any)
      .eq("id", contactId);

    console.log("[watcher] assigned", {
      contactId,
      intent: chosen.intent_key,
      flowId: chosen.flow_id,
      started: result.started,
      trigger,
    });

    return {
      ok: true,
      intent_key: chosen.intent_key,
      flow_id: chosen.flow_id,
      started: result.started,
      skipped: result.started ? undefined : result.message,
    };
  } catch (err) {
    console.warn("[watcher] error:", (err as Error)?.message);
    return { ok: false, skipped: (err as Error)?.message };
  }
}
