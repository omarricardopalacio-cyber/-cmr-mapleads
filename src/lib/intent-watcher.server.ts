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
  phone?: string | null;
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

function isJunkName(n?: string | null): boolean {
  if (!n) return true;
  const t = n.trim();
  if (!t) return true;
  if (/^[.\-…·_*]+$/.test(t)) return true;
  if (/^(n\/a|na|null|undefined|sin nombre|unknown|cliente\s*\d*)$/i.test(t)) return true;
  if (/^\+?\d{6,}$/.test(t)) return true;
  return false;
}

/** Detecta que el cliente confirmó agenda / compra (para badge Compró). */
function detectsScheduledOrBought(text: string): boolean {
  const hay = normalize(text);
  if (!hay) return false;
  const needles = [
    "ya agende",
    "ya agendo",
    "ya agende",
    "agende el pedido",
    "agendo el pedido",
    "agende mi pedido",
    "quedamos agendado",
    "quedo agendado",
    "quedó agendado",
    "pedido agendado",
    "confirmo el pedido",
    "confirmo pedido",
    "confirmo la compra",
    "si confirmo",
    "sí confirmo",
    "listo confirmo",
    "ya pague",
    "ya pagué",
    "ya realize el pago",
    "ya realicé el pago",
    "compre",
    "compré",
    "ya compre",
    "ya compré",
  ];
  if (needles.some((n) => hay.includes(normalize(n)))) return true;
  // "agende" / "agendo" solo (respuesta corta tras pedir datos)
  if (/^(si|sí|ok|listo|claro)?\s*(ya\s+)?(agende|agendo|agend[eé]|confirm[oe])\b/.test(hay)) {
    return true;
  }
  return false;
}

/**
 * Extracción determinista nombre / celular / ciudad / dirección
 * desde volcados multilínea (ej. "Narda\n3112466358\nSoacha\ncalle…").
 */
export function extractProfileHeuristics(text: string): ProfilePatch {
  const patch: ProfilePatch = {};
  if (!text?.trim()) return patch;

  const lines = text
    .split(/\r?\n|•|·|\|/)
    .map((l) => l.replace(/^[\s*•·\-]+/, "").trim())
    .filter(Boolean)
    .slice(0, 12);

  // Etiquetado: Nombre: X / Tel: Y
  for (const raw of lines) {
    const m = raw.match(
      /^\s*(nombre|name|tel[eé]fono|celular|cel|whatsapp|wa|ciudad|city|direcci[oó]n|dir|barrio|address)\s*[:\-]\s*(.+)$/i,
    );
    if (!m) continue;
    const key = normalize(m[1]);
    const val = m[2].trim();
    if (!val) continue;
    if (/nombre|name/.test(key) && !isJunkName(val)) patch.display_name = val.slice(0, 120);
    else if (/tel|cel|whatsapp|wa/.test(key)) {
      const d = val.replace(/\D/g, "");
      if (d.length >= 8 && d.length <= 15) patch.phone = d;
    } else if (/ciudad|city/.test(key)) patch.city = val.slice(0, 120);
    else if (/barrio/.test(key)) patch.neighborhood = val.slice(0, 120);
    else if (/dir|address/.test(key)) patch.address = val.slice(0, 240);
  }

  const phoneRe = /^(?:\+?57)?[\s\-.]?3\d{2}[\s\-.]?\d{3}[\s\-.]?\d{4}$|^\+?\d{8,15}$/;
  const addrRe =
    /\b(calle|carrera|cra\.?|cll\.?|av\.?|avenida|diag\.?|diagonal|transv|tv\.?|#|n[°ºo]|apto|apartamento|casa|manzana|mz|barrio)\b/i;
  const looksName = (s: string) =>
    !isJunkName(s) &&
    !phoneRe.test(s.replace(/\s/g, "")) &&
    !addrRe.test(s) &&
    /^[A-Za-zÁÉÍÓÚÑáéíóúñüÜ][A-Za-zÁÉÍÓÚÑáéíóúñüÜ\s.'-]{2,80}$/.test(s) &&
    s.split(/\s+/).length >= 1 &&
    s.split(/\s+/).length <= 6;

    for (const line of lines) {
    const digits = line.replace(/\D/g, "");
    const compact = line.replace(/\s/g, "");
    const isPhone =
      (!patch.phone && digits.length >= 8 && digits.length <= 15 && phoneRe.test(compact)) ||
      (!patch.phone && digits.length >= 10 && digits.length <= 13 && /^3\d{9}$/.test(digits));
    if (isPhone) {
      patch.phone = digits.startsWith("57") && digits.length === 12 ? digits.slice(2) : digits;
      continue;
    }
  }

  // Posicional: nombre, tel, ciudad/dir…
  const unused = lines.filter((l) => {
    const d = l.replace(/\D/g, "");
    if (patch.phone && d === patch.phone) return false;
    if (patch.phone && d.length >= 10 && d.includes(patch.phone)) return false;
    return true;
  });

  for (const line of unused) {
    if (!patch.display_name && looksName(line)) {
      patch.display_name = line.slice(0, 120);
      continue;
    }
    if (!patch.address && addrRe.test(line)) {
      patch.address = line.slice(0, 240);
      continue;
    }
    if (!patch.city && looksName(line) && line.split(/\s+/).length <= 3 && line.length <= 40) {
      // segunda línea tipo ciudad (Soacha, Bogotá)
      if (patch.display_name && normalize(line) !== normalize(patch.display_name)) {
        patch.city = line.slice(0, 120);
        continue;
      }
    }
  }

  // Si aún no hay dirección, la línea más larga restante suele ser la dirección
  if (!patch.address) {
    const rest = unused
      .filter((l) => normalize(l) !== normalize(patch.display_name || ""))
      .filter((l) => normalize(l) !== normalize(patch.city || ""))
      .filter((l) => {
        const d = l.replace(/\D/g, "");
        return !(patch.phone && d === patch.phone);
      })
      .sort((a, b) => b.length - a.length);
    if (rest[0] && rest[0].length >= 8 && (addrRe.test(rest[0]) || rest[0].split(/\s+/).length >= 3)) {
      patch.address = rest[0].slice(0, 240);
    }
  }

  return patch;
}

function mergeProfile(base: ProfilePatch, extra: ProfilePatch): ProfilePatch {
  return {
    display_name: base.display_name || extra.display_name,
    phone: base.phone || extra.phone,
    city: base.city || extra.city,
    address: base.address || extra.address,
    neighborhood: base.neighborhood || extra.neighborhood,
  };
}

function parseKeywords(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(/\r?\n|,/)
    .map((k) => normalize(k))
    // Mínimo 3: evita "si"/"la" y coincidencias accidentales en saludos.
    .filter((k) => k.length >= 3);
}

function isGreetingOnlyText(text: string): boolean {
  const n = normalize(text)
    .replace(/[!?¡¿.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|hi|hello|saludos)$/.test(
    n,
  );
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  if (!keywords.length) return false;
  const hay = normalize(text);
  return keywords.some((k) => {
    // Palabra completa para keywords cortas (≤5); contains para frases largas.
    if (k.length <= 5) {
      const re = new RegExp(`(?:^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`);
      return re.test(hay);
    }
    return hay.includes(k);
  });
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
{"intent_key":"<clave o null>","nombre":null,"telefono":null,"ciudad":null,"direccion":null,"barrio":null}
Reglas:
- intent_key debe ser una de las claves del catálogo, o null si ninguna encaja.
- Si el cliente confirma que agendó / confirmó el pedido / ya pagó / compró, usa intent_key "compro" si existe en el catálogo (o la clave equivalente de compra).
- Si el mensaje trae varias líneas sin etiquetas (nombre, celular, ciudad, dirección), mapéalas a nombre/telefono/ciudad/direccion.
- Solo rellena campos si el mensaje los menciona claramente. No inventes datos.`;

  const user = `Catálogo de intenciones:\n${JSON.stringify(catalog)}\n\nMensaje del cliente:\n${params.text.slice(0, 2000)}`;

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
    if (typeof parsed.nombre === "string" && parsed.nombre.trim() && !isJunkName(parsed.nombre)) {
      profile.display_name = parsed.nombre.trim().slice(0, 120);
    }
    if (typeof parsed.telefono === "string" && parsed.telefono.trim()) {
      const d = parsed.telefono.replace(/\D/g, "");
      if (d.length >= 8 && d.length <= 15) profile.phone = d;
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
  const { data: current } = await supabaseAdmin
    .from("contacts")
    .select("display_name, phone, city, address, neighborhood, wa_id")
    .eq("id", contactId)
    .maybeSingle();

  const updates: Record<string, string> = {};
  const curName = (current as any)?.display_name as string | null;
  const curPhone = (current as any)?.phone
    ? String((current as any).phone).replace(/\D/g, "")
    : "";
  const waId = String((current as any)?.wa_id || "");
  const lidDigits = waId.endsWith("@lid") ? waId.split("@")[0].replace(/\D/g, "") : "";

  if (patch.display_name && !isJunkName(patch.display_name)) {
    if (isJunkName(curName)) updates.display_name = patch.display_name;
  }
  if (patch.phone) {
    const p = patch.phone.replace(/\D/g, "");
    const phoneOk = p.length >= 8 && p.length <= 15 && p !== lidDigits;
    if (phoneOk && (!curPhone || curPhone === lidDigits)) updates.phone = p;
  }
  if (patch.city && !(current as any)?.city) updates.city = patch.city;
  if (patch.address && !(current as any)?.address) updates.address = patch.address;
  if (patch.neighborhood && !(current as any)?.neighborhood) {
    updates.neighborhood = patch.neighborhood;
  }

  if (!Object.keys(updates).length) return;
  updates.updated_at = new Date().toISOString();
  const { error } = await supabaseAdmin.from("contacts").update(updates).eq("id", contactId);
  if (error) console.warn("[watcher] profile update:", error.message);
}

async function markThreadPurchaseCompro(params: {
  orgId: string;
  contactId: string;
  threadId?: string | null;
}): Promise<void> {
  try {
    if (params.threadId) {
      await supabaseAdmin
        .from("threads")
        .update({ purchase_intent: "compro", updated_at: new Date().toISOString() } as any)
        .eq("id", params.threadId)
        .eq("org_id", params.orgId);
    } else {
      await supabaseAdmin
        .from("threads")
        .update({ purchase_intent: "compro", updated_at: new Date().toISOString() } as any)
        .eq("org_id", params.orgId)
        .eq("contact_id", params.contactId)
        .neq("purchase_intent", "compro");
    }

    const { assignComproTag } = await import("@/lib/purchase-tag.server");
    await assignComproTag({
      orgId: params.orgId,
      contactId: params.contactId,
      skipWatcher: true,
    });
  } catch (err) {
    console.warn("[watcher] mark compro:", (err as Error)?.message);
  }
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
  /**
   * Solo clasificar ficha (intención / perfil), sin iniciar flujos.
   * Obligatorio en importación de historial para no spamear WhatsApp.
   */
  skipFlowStart?: boolean;
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

    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, display_name, city, address, neighborhood, last_intent_key, last_intent_at, last_watcher_flow_id")
      .eq("id", contactId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (!contact) return { ok: false, skipped: "contacto_no_encontrado" };

    // Extracción de ficha siempre (aunque el vigilante esté apagado)
    let profile: ProfilePatch = {};
    if (text && config.extract_profile !== false) {
      profile = extractProfileHeuristics(text);
      if (Object.keys(profile).length) await applyProfilePatch(contactId, profile);
    }

    // Acumular pregunta / productos mencionados en el mensaje entrante
    if (text && trigger === "message") {
      try {
        const { appendContactAskedQuestion, appendContactAskedProduct, loadInquiryProductCatalog } =
          await import("@/lib/contact-inquiry.server");
        await appendContactAskedQuestion({ orgId, contactId, text });
        const catalog = await loadInquiryProductCatalog(orgId);
        const hay = text.toLowerCase();
        for (const p of catalog.slice(0, 200)) {
          const n = p.name.toLowerCase();
          if (n.length >= 4 && hay.includes(n)) {
            await appendContactAskedProduct({
              orgId,
              contactId,
              productName: p.name,
              productId: p.id,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    const scheduled = text ? detectsScheduledOrBought(text) : false;
    if (scheduled || params.forcedIntentKey === "compro") {
      await markThreadPurchaseCompro({
        orgId,
        contactId,
        threadId: params.threadId,
      });
    }

    if (!config.enabled) {
      return {
        ok: true,
        skipped: "vigilante_apagado",
        intent_key: scheduled ? "compro" : null,
      };
    }

    const rules = await loadActiveRules(orgId, trigger);
    if (!rules.length) {
      return {
        ok: true,
        skipped: "sin_reglas",
        intent_key: scheduled ? "compro" : null,
      };
    }

    let chosen: IntentRuleRow | null = null;

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
      // Saludo puro: extraer perfil si aplica, pero NO clasificar intención ni flujo.
      const greetingOnly = isGreetingOnlyText(text);

      // 0) Agendó / confirmó compra → intención compro si existe regla
      if (scheduled) {
        chosen =
          rules.find((r) => r.intent_key === "compro") ??
          rules.find((r) => r.intent_key === "agendo" || r.intent_key === "agendado") ??
          null;
      }

      // 1) Keywords primero (barato y determinista) — no en saludos
      if (!chosen && !greetingOnly) chosen = pickByKeywords(text, rules);

      // 2) IA vigilante (Groq propio) si hace falta
      const needsAi =
        !chosen &&
        !greetingOnly &&
        config.enabled &&
        !!config.grok_api_key &&
        rules.some((r) => r.match_type === "ai" || r.match_type === "both");

      if (
        (needsAi || (config.enabled && config.extract_profile && config.grok_api_key)) &&
        !greetingOnly
      ) {
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
            profile = mergeProfile(profile, ai.profile);
            if (!chosen && ai.intent_key) {
              chosen = rules.find((r) => r.intent_key === ai.intent_key) ?? null;
            }
          } catch (err) {
            console.warn("[watcher] classify:", (err as Error)?.message);
          }
        }
      } else if (greetingOnly && config.extract_profile) {
        // Perfil heurístico sin intención/flujo
        profile = mergeProfile(profile, extractProfileHeuristics(text));
      }
    }

    if (Object.keys(profile).length) {
      await applyProfilePatch(contactId, profile);
    }

    // Badge "Compró" si la regla es de compra (y aún no se marcó por heurística)
    const comproKeys = new Set(["compro", "agendo", "agendado", "compro_pedido"]);
    if (
      !scheduled &&
      params.forcedIntentKey !== "compro" &&
      chosen &&
      comproKeys.has(chosen.intent_key)
    ) {
      await markThreadPurchaseCompro({
        orgId,
        contactId,
        threadId: params.threadId,
      });
    }

    if (!chosen) {
      // Si solo marcamos compro por heurística sin regla, igual reportamos
      if (scheduled) {
        return { ok: true, intent_key: "compro", skipped: "compro_sin_regla_flujo" };
      }
      return { ok: true, skipped: "sin_match", intent_key: null };
    }

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

    // Solo ficha: no iniciar flujos (import historial / clasificación silenciosa)
    if (params.skipFlowStart) {
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
      return {
        ok: true,
        intent_key: chosen.intent_key,
        flow_id: chosen.flow_id,
        started: false,
        skipped: "solo_clasificacion",
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
