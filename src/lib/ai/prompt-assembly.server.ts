import process from "node:process";

/**
 * Modo de armado del SYSTEM prompt.
 *
 * Default: compact (menos tokens, hechos + conocimiento del turno).
 * Rollback: AI_PROMPT_MODE=legacy  ó  AI_COMPACT_PROMPT=false
 */
export function useLegacyAiPrompt(): boolean {
  const mode = String(process.env.AI_PROMPT_MODE || "")
    .toLowerCase()
    .trim();
  if (mode === "legacy" || mode === "full" || mode === "old") return true;
  if (mode === "compact" || mode === "new") return false;
  const compact = String(process.env.AI_COMPACT_PROMPT ?? "true")
    .toLowerCase()
    .trim();
  return compact === "0" || compact === "false" || compact === "no" || compact === "off";
}

export function getAiPromptModeLabel(): "legacy" | "compact" {
  return useLegacyAiPrompt() ? "legacy" : "compact";
}

/** Identidad: en compact no mandamos el system_prompt entero (suele ser un manual). */
export function clipIdentityPrompt(raw: string, maxChars = 1200): string {
  const text = (raw || "").trim();
  if (!text) {
    return "Eres un asistente comercial útil, cercano y proactivo. Acompañas al cliente hasta cerrar la compra.";
  }
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const breakAt = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf("\n#"), head.lastIndexOf("\n-"));
  const clipped = (breakAt > 400 ? head.slice(0, breakAt) : head).trim();
  return clipped + "\n…";
}

const COMPACT_RULES = `=== REGLAS (OBLIGATORIO) ===
- CONTEXTO CONSOLIDADO tiene prioridad máxima. No contradigas ni repitas preguntas de datos ya listados.
- Si hay CONOCIMIENTO DEL TURNO con precios/tarifas, responde el precio YA. Prohibido: "no lo tengo a la mano", "lo verifico".
- Máximo UNA pregunta por mensaje (EXCEPTO al pedir datos del pedido: ahí lista TODOS los campos del módulo de una vez).
- Respuestas breves (≤3 líneas salvo que pidan detalle o estés listando campos de pedido).
- No te presentes si ya hay historial. No inventes datos.
- Pedido confirmado solo con la herramienta confirm_order.`;

function compactFlowGuide(promptMode: string, needsPrice: boolean): string {
  if (promptMode === "pedido") {
    return `=== GUÍA (pedido) ===
1. No busques productos nuevos.
2. En el PRIMER pedido de datos: copia la plantilla con TODOS los campos del Módulo de Pedidos. PROHIBIDO pedir solo nombre/dirección u omitir campos.
3. Si ya faltan datos puntuales, pide solo el faltante.
4. Si el cliente confirma y tienes todo, ejecuta confirm_order.`;
  }
  if (needsPrice) {
    return `=== GUÍA (cotizar) ===
1. Usa CONTEXTO CONSOLIDADO + CONOCIMIENTO DEL TURNO.
2. Aplica la tarifa de la ciudad (local vs resto del país) y responde precio.
3. Cierra con una sola pregunta suave (agendar / color / confirmar).`;
  }
  if (promptMode === "product_detail" || promptMode === "product_focus") {
    return `=== GUÍA (producto en foco) ===
1. Prioridad ABSOLUTA: ficha + OBSERVACIÓN DEL VENDEDOR. Ahí están precio, envío y cómo atender. NO uses base de conocimiento ni tarifas de otros productos.
2. Si el cliente pregunta precio, envío o ciudad: responde YA con lo que diga la OBSERVACIÓN. PROHIBIDO decir "no tengo esa información" o transferir a humano.
3. Usa los FLUJOS DE ESTE PRODUCTO (activate_flow) cuando encajen. Si pide OTRO producto por nombre/SKU, usa present_product.
4. Solo si un dato NO aparece en ficha ni observación, dilo breve. No inventes. No transfieras por precio/envío.`;
  }
  return `=== GUÍA (general) ===
1. Si el cliente menciona un producto por nombre, SKU o características: búscalo en catálogo y usa present_product. Si no está, responde con base de conocimiento.
2. Continúa desde el contexto consolidado y paquetes generales si aplican.
3. Una pregunta por mensaje.
4. Si el cliente cotiza (ciudad/precio), usa el conocimiento del turno.`;
}

function looksLikeNumberSelection(text: string): boolean {
  return /^(?:el|la|opci[oó]n|n[uú]mero|#)?\s*\d{1,2}$/i.test((text || "").trim());
}

export type SystemPromptParts = {
  identity: string;
  promptMode: string;
  conversationStateText: string;
  threadPromptExtensionText: string;
  conversationRulesText: string;
  customerMemoryText: string;
  salesPackagesText: string;
  activePackageContextText: string;
  selectedProductText: string;
  knowledgeBase: string;
  mandatoryPriceKnowledgeText: string;
  toolsHintLegacy: string;
  activeFlowGuide: string;
  orderStateText: string;
  orderFieldsText: string;
  knowledgeSourcesText: string;
  dynamicContextText: string;
  needsPriceContext: boolean;
  isCollectingOrder: boolean;
  startOrderFlow: boolean;
  lastUserText: string;
  hasActivePackage: boolean;
  factCount: number;
  fechaLine: string;
  recentProductsBlock: string;
};

/** Prompt largo anterior (rollback). */
export function buildLegacySystemPrompt(p: SystemPromptParts): string {
  if (p.promptMode === "product_focus") {
    return [
      clipIdentityPrompt(p.identity, 600),
      `\n\n=== MODO PRODUCTO EN FOCO ===\nUsa SOLO la ficha, la OBSERVACIÓN DEL VENDEDOR y los FLUJOS de este producto. Prohibido inventar con base de conocimiento u otros productos.`,
      p.conversationStateText,
      p.selectedProductText,
      p.salesPackagesText,
      p.activePackageContextText,
      `\n\n${compactFlowGuide("product_focus", false)}`,
      p.isCollectingOrder || p.startOrderFlow ? p.orderStateText : "",
      p.isCollectingOrder || p.startOrderFlow ? p.orderFieldsText : "",
    ]
      .filter(Boolean)
      .join("");
  }
  return [
    p.identity,
    `\n\n=== MODO DE PROMPT DINÁMICO ===\nmodo: ${p.promptMode}\nUsa solo el contexto incluido aquí. Para detalles del producto elegido, prioriza PRODUCTO ELEGIDO y BASE DE CONOCIMIENTO relevante; no reinicies búsqueda ni envías otra ronda de imágenes salvo que el cliente pida otros productos.`,
    p.conversationStateText,
    p.threadPromptExtensionText,
    p.conversationRulesText,
    p.customerMemoryText,
    p.salesPackagesText,
    p.activePackageContextText,
    p.selectedProductText,
    p.knowledgeBase ? `\n\n=== BASE DE CONOCIMIENTO / PRODUCTOS ===\n${p.knowledgeBase}` : "",
    p.mandatoryPriceKnowledgeText,
    p.toolsHintLegacy,
    "\n\n" + p.activeFlowGuide,
    p.orderStateText,
    p.orderFieldsText,
    p.knowledgeSourcesText,
    p.dynamicContextText,
  ]
    .filter(Boolean)
    .join("");
}

/**
 * Prompt compacto: identidad corta + hechos + 1 conocimiento del turno + guías mínimas.
 * Sin guía de catálogo; sin bloques repetidos.
 */
export function buildCompactSystemPrompt(p: SystemPromptParts): string {
  const identity = clipIdentityPrompt(p.identity, 1200);
  const modeLine = `\n\nmodo: ${p.promptMode}${p.needsPriceContext ? " | cotizar" : ""}`;

  const includeMemory =
    !!p.customerMemoryText &&
    p.factCount < 2; // al inicio; luego mandan los hechos

  const packageShort = p.hasActivePackage
    ? clipBlock(p.activePackageContextText, 900)
    : "";

  const knowledgeTurn =
    p.promptMode === "product_focus" ? "" : buildKnowledgeTurnBlock(p);
  const includeOrder = p.isCollectingOrder || p.startOrderFlow || p.promptMode === "pedido";
  const includeProduct =
    !!p.selectedProductText &&
    (p.promptMode === "product_detail" ||
      p.promptMode === "product_focus" ||
      includeOrder ||
      p.startOrderFlow);
  const includeRecentProducts =
    !!p.recentProductsBlock && looksLikeNumberSelection(p.lastUserText);
  const includeFecha =
    !!p.fechaLine &&
    (p.needsPriceContext || includeOrder || /\b(ma[nñ]ana|entrega|llega|horario)\b/i.test(p.lastUserText));

  // En product_focus: identidad corta + producto/observación + flujos del producto
  if (p.promptMode === "product_focus") {
    return [
      clipIdentityPrompt(p.identity, 500),
      modeLine,
      includeProduct ? p.selectedProductText : "",
      p.salesPackagesText ? clipBlock(p.salesPackagesText, 1600) : "",
      p.activePackageContextText ? clipBlock(p.activePackageContextText, 900) : "",
      `\n\n${COMPACT_RULES}`,
      `\n\n${compactFlowGuide(p.promptMode, false)}`,
      includeOrder ? p.orderStateText : "",
      includeOrder ? clipBlock(p.orderFieldsText, 4500) : "",
    ]
      .filter(Boolean)
      .join("");
  }

  return [
    identity,
    modeLine,
    p.conversationStateText,
    `\n\n${COMPACT_RULES}`,
    p.threadPromptExtensionText ? clipBlock(p.threadPromptExtensionText, 800) : "",
    includeMemory ? clipBlock(p.customerMemoryText, 300) : "",
    // Sin foco: siempre mostrar paquetes generales si hay (descubrimiento WhatsApp)
    p.salesPackagesText ? clipBlock(p.salesPackagesText, 1400) : "",
    packageShort,
    includeProduct ? p.selectedProductText : "",
    knowledgeTurn,
    `\n\n${compactFlowGuide(p.promptMode, p.needsPriceContext)}`,
    includeOrder ? p.orderStateText : "",
    includeOrder ? clipBlock(p.orderFieldsText, 4500) : "",
    includeFecha ? `\n\nfecha: ${p.fechaLine}` : "",
    includeRecentProducts ? p.recentProductsBlock : "",
  ]
    .filter(Boolean)
    .join("");
}

function clipBlock(text: string, max: number): string {
  const t = (text || "").trim();
  if (!t) return "";
  if (t.length <= max) return t.startsWith("\n") ? t : `\n\n${t}`;
  const body = t.slice(0, max).trim() + "…";
  return body.startsWith("\n") ? body : `\n\n${body}`;
}

function buildKnowledgeTurnBlock(p: SystemPromptParts): string {
  const chunks: string[] = [];
  if (p.mandatoryPriceKnowledgeText?.trim()) {
    chunks.push(
      p.mandatoryPriceKnowledgeText
        .replace(/^\n+/, "")
        .replace(
          /^=== TARIFAS Y PRECIOS[\s\S]*?===\n?/m,
          "",
        )
        .trim() || p.mandatoryPriceKnowledgeText.trim(),
    );
  }
  if (p.knowledgeBase?.trim() && !p.needsPriceContext) {
    chunks.push(p.knowledgeBase.trim());
  } else if (p.knowledgeBase?.trim() && p.needsPriceContext && p.knowledgeBase.length < 1500) {
    // KB corta de la org: útil junto a tarifas
    chunks.push(p.knowledgeBase.trim());
  }
  if (p.knowledgeSourcesText?.trim()) {
    chunks.push(
      p.knowledgeSourcesText
        .replace(/^\n+/, "")
        .replace(/^=== (CONOCIMIENTO RELEVANTE|FUENTES DE CONOCIMIENTO)[\s\S]*?===\n?/m, "")
        .trim(),
    );
  }
  const body = chunks.filter(Boolean).join("\n\n").trim();
  if (!body) return "";
  return (
    `\n\n=== CONOCIMIENTO DEL TURNO ===\n` +
    `Usa SOLO este bloque para datos/precios de esta respuesta. No digas que faltan si aparecen aquí.\n\n` +
    body.slice(0, 8000)
  );
}

export function assembleSystemPrompt(p: SystemPromptParts): {
  system: string;
  mode: "legacy" | "compact";
} {
  const legacy = useLegacyAiPrompt();
  return {
    mode: legacy ? "legacy" : "compact",
    system: legacy ? buildLegacySystemPrompt(p) : buildCompactSystemPrompt(p),
  };
}

/** Historial más corto en compact; legacy usa todo lo cargado. */
export function selectHistoryForPrompt<T>(messages: T[], legacy: boolean): T[] {
  if (legacy) return messages;
  if (messages.length <= 14) return messages;
  return messages.slice(-14);
}
