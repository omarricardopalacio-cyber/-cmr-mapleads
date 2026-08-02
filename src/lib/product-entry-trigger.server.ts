/**
 * Activador determinista por frase (primer mensaje del chat).
 * Si coincide → enfoca el producto y arranca su flujo inicial (sin búsqueda IA).
 *
 * Matching:
 * - Sin variables → "contiene" (el mensaje incluye la frase; no exige igualdad exacta).
 * - Con variables → patrón: `{nombre}`, `{{nombre}}` o `*` = cualquier texto.
 *   Ej: "deseo informacion de {producto}" coincide con
 *       "hola deseo informacion de AB VERTICAL por favor".
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export function normalizeTriggerText(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True si la frase usa comodines / variables. */
export function phraseHasVariables(phrase: string): boolean {
  return /\{\{?[^{}]+\}?\}|\*/.test(String(phrase || ""));
}

/**
 * Convierte frase con variables a RegExp sobre texto ya normalizado.
 * Literales se escapan; `{x}`, `{{x}}` y `*` → [\s\S]*?
 */
export function triggerPhraseToRegExp(normalizedPhrase: string): RegExp | null {
  const src = String(normalizedPhrase || "");
  if (!src) return null;

  // Partes: {{var}} | {var} | * | texto literal
  const parts = src.split(/(\{\{[^{}]+\}\}|\{[^{}]+\}|\*)/g).filter((p) => p.length > 0);
  let pattern = "";
  let hasLiteral = false;
  for (const part of parts) {
    if (part === "*" || /^\{\{[^{}]+\}\}$/.test(part) || /^\{[^{}]+\}$/.test(part)) {
      pattern += "[\\s\\S]*?";
    } else {
      hasLiteral = true;
      pattern += part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  // Evitar frases solo-variable (matchearían todo)
  if (!hasLiteral || pattern.replace(/\[\\s\\S\]\*\?/g, "").trim().length < 3) {
    return null;
  }
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

/** ¿El mensaje activa esta frase? (contiene o patrón con variables). */
export function messageMatchesEntryTrigger(messageNorm: string, phraseRaw: string): boolean {
  const phraseNorm = normalizeTriggerText(phraseRaw);
  if (!messageNorm || phraseNorm.length < 3) return false;

  if (phraseHasVariables(phraseRaw) || phraseHasVariables(phraseNorm)) {
    // Normalizar variables conservando marcadores (tras NFD/lower siguen {x})
    const re = triggerPhraseToRegExp(phraseNorm);
    if (!re) return false;
    return re.test(messageNorm);
  }

  // Sin variables: contiene (no igualdad exacta)
  return messageNorm.includes(phraseNorm);
}

export type ProductEntryTriggerMatch = {
  productId: string;
  productName: string;
  phrase: string;
};

/**
 * Busca el producto activo cuya frase activadora coincide con el texto.
 * Si hay varias, gana la frase más larga / más específica (más literales).
 */
export async function findProductByEntryTrigger(params: {
  orgId: string;
  text: string;
}): Promise<ProductEntryTriggerMatch | null> {
  const hay = normalizeTriggerText(params.text);
  if (!hay || hay.length < 3) return null;

  let rows: Array<{ id: string; name: string; entry_trigger_phrase: string | null }> | null =
    null;
  const res = await (supabaseAdmin as any)
    .from("products")
    .select("id, name, entry_trigger_phrase")
    .eq("org_id", params.orgId)
    .eq("is_active", true)
    .not("entry_trigger_phrase", "is", null)
    .limit(500);

  if (res.error) {
    if (
      String(res.error.message || "").includes("entry_trigger_phrase") ||
      res.error.code === "42703"
    ) {
      return null;
    }
    console.warn("[product-entry-trigger] query:", res.error.message);
    return null;
  }
  rows = res.data || [];

  let best: ProductEntryTriggerMatch | null = null;
  let bestLen = 0;
  for (const p of rows || []) {
    const rawPhrase = String(p.entry_trigger_phrase || "").trim();
    const phrase = normalizeTriggerText(rawPhrase);
    if (phrase.length < 3) continue;
    if (!messageMatchesEntryTrigger(hay, rawPhrase)) continue;
    // Especificidad: longitud de la parte literal (sin variables)
    const literalLen = phrase
      .replace(/\{\{?[^{}]+\}?\}/g, "")
      .replace(/\*/g, "")
      .trim().length;
    const score = literalLen > 0 ? literalLen : phrase.length;
    if (score > bestLen) {
      bestLen = score;
      best = {
        productId: String(p.id),
        productName: String(p.name || ""),
        phrase: rawPhrase,
      };
    }
  }
  return best;
}

/**
 * Activa por frase mientras el hilo no tenga producto en foco.
 * No se limita al primer inbound: es normal que el cliente primero salude y
 * luego envíe la frase del anuncio en un segundo mensaje.
 */
export async function tryProductEntryTriggerOnFirstMessage(params: {
  orgId: string;
  threadId: string;
  contactId: string | null;
  sessionId?: string | null;
  chatId?: string | null;
  text: string;
}): Promise<{ activated: boolean; productId?: string; productName?: string; reason?: string }> {
  const text = String(params.text || "").trim();
  if (!text) return { activated: false, reason: "empty" };

  // Saludo puro no debe enfocar producto (aunque la frase sea "hola").
  const greetingNorm = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!?¡¿.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|hi|hello|saludos)$/.test(
      greetingNorm,
    )
  ) {
    return { activated: false, reason: "greeting_only" };
  }

  const { data: thread } = await supabaseAdmin
    .from("threads")
    .select("id, focused_product_id")
    .eq("id", params.threadId)
    .eq("org_id", params.orgId)
    .maybeSingle();

  if (!thread) return { activated: false, reason: "no_thread" };
  if ((thread as any).focused_product_id) {
    return { activated: false, reason: "already_focused" };
  }

  const match = await findProductByEntryTrigger({
    orgId: params.orgId,
    text,
  });
  if (!match) return { activated: false, reason: "no_match" };

  try {
    const { presentProductToThread } = await import("@/lib/store-product-chat.server");
    const presented = await presentProductToThread({
      orgId: params.orgId,
      threadId: params.threadId,
      contactId: params.contactId,
      productId: match.productId,
      sessionId: params.sessionId,
      chatId: params.chatId,
    });
    if (!presented) {
      return { activated: false, reason: "present_failed", productId: match.productId };
    }
    console.info("[product-entry-trigger] activado", {
      orgId: params.orgId,
      threadId: params.threadId,
      productId: match.productId,
      phrase: match.phrase,
    });
    return {
      activated: true,
      productId: match.productId,
      productName: match.productName,
    };
  } catch (err) {
    console.warn(
      "[product-entry-trigger]",
      err instanceof Error ? err.message : String(err),
    );
    return { activated: false, reason: "error", productId: match.productId };
  }
}
