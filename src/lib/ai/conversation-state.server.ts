import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ConversationFactKey =
  | "product"
  | "city"
  | "quantity"
  | "color"
  | "material"
  | "price_quoted"
  | "intent"
  | "note";

export type ConversationFact = {
  key: ConversationFactKey | string;
  value: string;
  label: string;
  updated_at: string;
};

export type ConversationState = {
  facts: ConversationFact[];
  updated_at?: string;
};

export type PromptPlan = {
  intent: string;
  needsPrice: boolean;
  retrievalQuery: string;
  preferredSourceHints: string[];
  summary: string;
};

const COLOMBIA_CITIES =
  /\b(bogot[aá]|medell[ií]n|cali|barranquilla|cartagena|bucaramanga|pereira|manizales|c[uú]cuta|ibagu[eé]|neiva|villavicencio|armenia|pasto|monter[ií]a|valledupar|santa\s*marta|popay[aá]n|tunja|sincelejo|riohacha|quibd[oó]|florencia|yopal|soacha|chia|ch[ií]a|envigado|itag[uü][ií]|bello|rionegro)\b/i;

const PRODUCT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bforros?\b.*\bsillas?\b|\bsillas?\b.*\bforros?\b|\bfundas?\b.*\bsillas?\b/i, label: "forros para sillas de comedor" },
  { re: /\bforros?\b/i, label: "forros" },
  { re: /\bzapateros?\b/i, label: "zapatero" },
  { re: /\borganizadores?\b/i, label: "organizador" },
  { re: /\bcojines?\b/i, label: "cojines" },
  { re: /\bcortinas?\b/i, label: "cortinas" },
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeCity(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  const map: Record<string, string> = {
    bogota: "Bogotá",
    bogotá: "Bogotá",
    medellin: "Medellín",
    medellín: "Medellín",
    cali: "Cali",
    barranquilla: "Barranquilla",
    cartagena: "Cartagena",
  };
  const key = t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return map[key] || t.charAt(0).toUpperCase() + t.slice(1);
}

export function emptyConversationState(): ConversationState {
  return { facts: [], updated_at: nowIso() };
}

export function upsertFact(
  state: ConversationState,
  key: ConversationFactKey | string,
  value: string,
  label: string,
): ConversationState {
  const cleanValue = String(value || "").trim();
  const cleanLabel = String(label || "").trim();
  if (!cleanValue || !cleanLabel) return state;

  const facts = [...(state.facts || [])];
  const idx = facts.findIndex((f) => f.key === key);
  const fact: ConversationFact = {
    key,
    value: cleanValue,
    label: cleanLabel,
    updated_at: nowIso(),
  };
  if (idx >= 0) facts[idx] = fact;
  else facts.push(fact);

  return { facts, updated_at: nowIso() };
}

export function getFact(state: ConversationState, key: string): string | null {
  const f = state.facts?.find((x) => x.key === key);
  return f?.value?.trim() || null;
}

/**
 * Lista numerada para el prompt — predomina sobre el historial suelto.
 */
export function formatConversationStateForPrompt(state: ConversationState): string {
  const facts = state.facts || [];
  if (!facts.length) return "";
  const lines = facts.map((f, i) => `${i + 1}. ${f.label}`);
  return (
    `=== CONTEXTO CONSOLIDADO DE ESTA CONVERSACIÓN (PRIORIDAD MÁXIMA) ===\n` +
    lines.join("\n") +
    `\n\nUsa SIEMPRE estos hechos. No vuelvas a preguntar lo que ya está listado. ` +
    `Si falta un dato para cotizar o cerrar, pregunta SOLO ese. ` +
    `Si hay ciudad + producto/cantidad y hay tarifas en la base, responde el precio de una vez.`
  );
}

/**
 * Extrae hechos del historial reciente (reglas, sin LLM extra).
 */
export function extractFactsFromMessages(
  messages: Array<{ role: string; content: string }>,
  prev: ConversationState = emptyConversationState(),
): ConversationState {
  let state = { facts: [...(prev.facts || [])], updated_at: nowIso() };
  const recent = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
    .slice(-12);

  const allText = recent.map((m) => m.content).join("\n");
  const lastUser =
    [...recent].reverse().find((m) => m.role === "user")?.content?.trim() || "";
  const lastAssistant =
    [...recent].reverse().find((m) => m.role === "assistant")?.content?.trim() || "";

  // Producto (usuario o pitch del asistente/flujo)
  for (const p of PRODUCT_PATTERNS) {
    if (p.re.test(allText)) {
      state = upsertFact(state, "product", p.label, `Cliente desea: ${p.label}`);
      break;
    }
  }

  // Ciudad
  const cityFromUser = lastUser.match(COLOMBIA_CITIES);
  const cityFromAny = allText.match(COLOMBIA_CITIES);
  const cityHit = cityFromUser || cityFromAny;
  if (cityHit) {
    const city = normalizeCity(cityHit[1]);
    state = upsertFact(state, "city", city, `Cliente es de: ${city}`);
  }

  // Cantidad (número corto o "4 sillas" / "juego de 4")
  const qtyPatterns = [
    /(?:juego\s+de|para|son|quiero|deseo|necesito)\s*(\d{1,2})\s*(?:forros?|sillas?|unidades?)?/i,
    /^(\d{1,2})$/,
    /\b(\d{1,2})\s*(?:forros?|sillas?)\b/i,
  ];
  for (const re of qtyPatterns) {
    const m = lastUser.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 99) {
        state = upsertFact(state, "quantity", String(n), `Cantidad: ${n}`);
        break;
      }
    }
  }

  // Color
  const colorMatch = lastUser.match(
    /\b(negro|negra|blanco|blanca|rojo|roja|rojos|rojas|azul|verde|gris|beige|caf[eé]|marr[oó]n|dorado|plateado)\b/i,
  );
  if (colorMatch) {
    const color = colorMatch[1].toLowerCase();
    state = upsertFact(state, "color", color, `Desea color: ${color}`);
  }

  // Material
  const materialMatch = lastUser.match(
    /\b(madera|metal|pl[aá]stico|vidrio|acero|tela|cuero|poliester|poli[eé]ster|elastano)\b/i,
  );
  if (materialMatch) {
    const material = materialMatch[1].toLowerCase();
    state = upsertFact(state, "material", material, `Material preferido: ${material}`);
  }

  // Precio ya informado por el asistente
  const priceMatch = lastAssistant.match(
    /\$\s*[\d]{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\b\d{2,3}[.\s]\d{3}\s*(?:cop)?/i,
  );
  if (priceMatch && /\b(precio|promoci|forro|cop|\$|vale|valor)\b/i.test(lastAssistant)) {
    const price = priceMatch[0].replace(/\s+/g, " ").trim();
    state = upsertFact(
      state,
      "price_quoted",
      price,
      `Se le informó el precio: ${price}`,
    );
  }

  // Intención de compra
  if (/\b(quiero\s+comprar|lo\s+llevo|agendar|hacer\s+pedido|lo\s+pido)\b/i.test(lastUser)) {
    state = upsertFact(state, "intent", "ready", "Intención: listo para comprar/agendar");
  } else if (/\b(precio|cu[aá]nto|valor|costo|info|informaci[oó]n)\b/i.test(lastUser)) {
    state = upsertFact(state, "intent", "interested", "Intención: interesado / cotizando");
  }

  return state;
}

/**
 * Planificador: con hechos + último mensaje decide cómo armar el retrieval de KB.
 * (Reglas deterministas; barato y estable. Se puede ampliar luego con un LLM flash.)
 */
export function planPromptContext(params: {
  state: ConversationState;
  lastUserText: string;
  lastAssistantText?: string;
  activePackageName?: string;
}): PromptPlan {
  const { state, lastUserText, lastAssistantText = "", activePackageName = "" } = params;
  const product = getFact(state, "product") || "";
  const city = getFact(state, "city") || "";
  const quantity = getFact(state, "quantity") || "";
  const color = getFact(state, "color") || "";

  const askedCity =
    /\b(ciudad|desde\s+qu[eé]\s+ciudad|de\s+qu[eé]\s+ciudad)\b/i.test(lastAssistantText);
  const shortCityReply = COLOMBIA_CITIES.test(lastUserText) || (askedCity && lastUserText.trim().length <= 40);
  const needsPrice =
    !!city ||
    shortCityReply ||
    !!activePackageName ||
    /\b(precio|precios|cu[aá]nto|valor|costo|tarifa|cotiz)\b/i.test(lastUserText) ||
    (askedCity && !!lastUserText.trim());

  let intent = "general";
  if (needsPrice) intent = "cotizar";
  else if (/\b(foto|imagen|video|ver)\b/i.test(lastUserText)) intent = "media";
  else if (/\b(pedido|agendar|comprar|envio|env[ií]o)\b/i.test(lastUserText)) intent = "pedido";
  else if (product) intent = "producto";

  const preferredSourceHints = [
    needsPrice ? "precio" : "",
    needsPrice ? "tarifa" : "",
    product,
    product.includes("forro") ? "forros" : "",
    product.includes("zapatero") ? "zapatero" : "",
    intent === "pedido" ? "compra" : "",
    intent === "pedido" ? "entrega" : "",
  ].filter(Boolean);

  const retrievalQuery = [
    lastUserText,
    product && `producto ${product}`,
    city && `ciudad ${city}`,
    quantity && `cantidad ${quantity}`,
    color && `color ${color}`,
    activePackageName,
    needsPrice ? "precio precios valor tarifa promocion" : "",
  ]
    .filter(Boolean)
    .join("\n");

  const summary = formatConversationStateForPrompt(state);

  return {
    intent,
    needsPrice,
    retrievalQuery,
    preferredSourceHints,
    summary,
  };
}

export async function loadConversationState(
  orgId: string,
  threadId: string,
  contactId?: string,
): Promise<ConversationState> {
  try {
    const { data, error } = await (supabaseAdmin as any)
      .from("threads")
      .select("ai_conversation_state")
      .eq("id", threadId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (!error && data?.ai_conversation_state && typeof data.ai_conversation_state === "object") {
      const raw = data.ai_conversation_state as any;
      const facts = Array.isArray(raw.facts) ? raw.facts : [];
      return {
        facts: facts.filter((f: any) => f && f.key && f.label && f.value),
        updated_at: raw.updated_at || nowIso(),
      };
    }

    // Fallback: contacts.ai_memory.conversation_states[threadId] (si aún no hay columna)
    if (contactId) {
      const { data: contact } = await (supabaseAdmin as any)
        .from("contacts")
        .select("ai_memory")
        .eq("id", contactId)
        .eq("org_id", orgId)
        .maybeSingle();
      const raw = contact?.ai_memory?.conversation_states?.[threadId];
      if (raw && typeof raw === "object") {
        const facts = Array.isArray(raw.facts) ? raw.facts : [];
        return {
          facts: facts.filter((f: any) => f && f.key && f.label && f.value),
          updated_at: raw.updated_at || nowIso(),
        };
      }
    }

    if (error) {
      console.warn("[conversation-state] load failed", error.message || error);
    }
    return emptyConversationState();
  } catch (err) {
    console.warn("[conversation-state] load unexpected", err);
    return emptyConversationState();
  }
}

export async function saveConversationState(
  orgId: string,
  threadId: string,
  state: ConversationState,
  contactId?: string,
): Promise<void> {
  const payload = {
    facts: (state.facts || []).slice(-20),
    updated_at: nowIso(),
  };

  try {
    const { error } = await (supabaseAdmin as any)
      .from("threads")
      .update({ ai_conversation_state: payload })
      .eq("id", threadId)
      .eq("org_id", orgId);

    if (!error) return;

    // Fallback a contacts.ai_memory si la columna no existe aún
    console.warn("[conversation-state] thread save failed, using contact fallback", error.message || error);
  } catch (err) {
    console.warn("[conversation-state] thread save unexpected", err);
  }

  if (!contactId) return;
  try {
    const { data: contact } = await (supabaseAdmin as any)
      .from("contacts")
      .select("ai_memory")
      .eq("id", contactId)
      .eq("org_id", orgId)
      .maybeSingle();
    const mem = (contact?.ai_memory && typeof contact.ai_memory === "object" ? contact.ai_memory : {}) as Record<
      string,
      any
    >;
    const states = { ...(mem.conversation_states || {}), [threadId]: payload };
    // Limitar a 5 hilos recientes
    const keys = Object.keys(states);
    if (keys.length > 5) {
      for (const k of keys.slice(0, keys.length - 5)) delete states[k];
    }
    await (supabaseAdmin as any)
      .from("contacts")
      .update({
        ai_memory: { ...mem, conversation_states: states },
        updated_at: nowIso(),
      })
      .eq("id", contactId)
      .eq("org_id", orgId);
  } catch (err) {
    console.warn("[conversation-state] contact fallback save failed", err);
  }
}

/**
 * Carga → extrae del historial → guarda. Devuelve estado + plan para armar el prompt.
 */
export async function refreshConversationStateAndPlan(params: {
  orgId: string;
  threadId: string;
  contactId?: string;
  messages: Array<{ role: string; content: string }>;
  lastUserText: string;
  lastAssistantText?: string;
  activePackageName?: string;
}): Promise<{ state: ConversationState; plan: PromptPlan }> {
  const prev = await loadConversationState(params.orgId, params.threadId, params.contactId);
  const state = extractFactsFromMessages(params.messages, prev);
  await saveConversationState(params.orgId, params.threadId, state, params.contactId);
  const plan = planPromptContext({
    state,
    lastUserText: params.lastUserText,
    lastAssistantText: params.lastAssistantText,
    activePackageName: params.activePackageName,
  });
  return { state, plan };
}

/**
 * Tras la respuesta de la IA, consolida precio informado u otros hechos del reply.
 */
export async function updateConversationStateAfterReply(params: {
  orgId: string;
  threadId: string;
  contactId?: string;
  userText: string;
  assistantReply: string;
}): Promise<void> {
  const prev = await loadConversationState(params.orgId, params.threadId, params.contactId);
  const merged = extractFactsFromMessages(
    [
      { role: "user", content: params.userText },
      { role: "assistant", content: params.assistantReply },
    ],
    prev,
  );
  await saveConversationState(params.orgId, params.threadId, merged, params.contactId);
}
