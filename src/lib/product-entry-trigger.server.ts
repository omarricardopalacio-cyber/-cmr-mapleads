/**
 * Activador determinista por frase (primer mensaje del chat).
 * Si coincide → enfoca el producto y arranca su flujo inicial (sin búsqueda IA).
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

export type ProductEntryTriggerMatch = {
  productId: string;
  productName: string;
  phrase: string;
};

/**
 * Busca el producto activo cuya frase activadora está contenida en el texto.
 * Si hay varias, gana la frase más larga (más específica).
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
    const phrase = normalizeTriggerText(String(p.entry_trigger_phrase || ""));
    if (phrase.length < 3) continue;
    if (!hay.includes(phrase)) continue;
    if (phrase.length > bestLen) {
      bestLen = phrase.length;
      best = {
        productId: String(p.id),
        productName: String(p.name || ""),
        phrase: String(p.entry_trigger_phrase || "").trim(),
      };
    }
  }
  return best;
}

/**
 * Solo primer mensaje inbound del hilo, sin producto en foco aún.
 * Devuelve true si activó foco + flujo / ficha.
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

  const { count: inboundCount } = await supabaseAdmin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", params.threadId)
    .eq("direction", "in");

  // Solo el primer mensaje entrante del chat
  if ((inboundCount ?? 0) !== 1) {
    return { activated: false, reason: "not_first_inbound" };
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
