import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  isFlowFieldEnabled,
  normalizeFlowFieldDelays,
  normalizeFlowFieldOrder,
  getFlowFieldDelay,
  type FlowFieldId,
} from "@/lib/product-chat-flow";

export type FocusStoreProductResult = {
  productId: string;
  productName: string;
  switched: boolean;
  introSent: boolean;
  imageUrl: string | null;
  videoUrl: string | null;
  galleryImages: string[];
  price: number | null;
  product?: Record<string, unknown>;
};

function formatCop(price: number | null | undefined) {
  if (price == null || Number.isNaN(Number(price))) return "Consultar";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(price));
}

function parseGalleryImages(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((u): u is string => typeof u === "string" && !!u.trim())
      .map((u) => u.trim())
      .slice(0, 12);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      return parseGalleryImages(JSON.parse(raw));
    } catch {
      if (raw.startsWith("http")) return [raw.trim()];
    }
  }
  return [];
}

type FlowOutMessage = {
  text: string | null;
  media: { url: string; type: "image" | "video"; mimeType: string } | null;
  kind: string;
  /** Segundos a esperar DESPUÉS de este mensaje antes del siguiente. */
  delayAfterSec: number;
};

function textForField(product: any, id: FlowFieldId): string | null {
  switch (id) {
    case "name":
      return `📦 *${product.name}*`;
    case "badge":
      return product.badge ? `Etiqueta: ${product.badge}` : null;
    case "category":
      return product.category ? `Categoría: ${product.category}` : null;
    case "price":
      return `Precio: ${formatCop(product.price)}`;
    case "sku":
      return product.sku ? `SKU: ${product.sku}` : null;
    case "stock":
      return product.stock != null ? `Stock: ${product.stock}` : null;
    case "description":
      return product.description ? String(product.description).slice(0, 1500) : null;
    default:
      return null;
  }
}

/** Mensajes individuales del flujo (textos + media real, sin URLs en texto). */
function buildFlowMessages(product: any): FlowOutMessage[] {
  const flow = (product.chat_flow as Record<string, unknown>) || {};
  const order = normalizeFlowFieldOrder(flow.field_order);
  const delays = normalizeFlowFieldDelays(flow.field_delays);
  const out: FlowOutMessage[] = [];

  for (const id of order) {
    if (!isFlowFieldEnabled(flow, id)) continue;
    const delayAfterSec = getFlowFieldDelay(delays, id);

    if (id === "image") {
      const url = product.image_url ? String(product.image_url).trim() : "";
      if (!url) continue;
      out.push({
        text: null,
        media: { url, type: "image", mimeType: "image/jpeg" },
        kind: "product_image",
        delayAfterSec,
      });
      continue;
    }

    if (id === "video") {
      const url = product.video_url ? String(product.video_url).trim() : "";
      if (!url) continue;
      out.push({
        text: null,
        media: { url, type: "video", mimeType: "video/mp4" },
        kind: "product_video",
        delayAfterSec,
      });
      continue;
    }

    if (id === "gallery") {
      const gallery = parseGalleryImages(product.gallery_images);
      gallery.forEach((url, i) => {
        const isLast = i === gallery.length - 1;
        out.push({
          text: null,
          media: { url, type: "image", mimeType: "image/jpeg" },
          kind: `product_gallery_${i}`,
          // Entre fotos de galería y después de la última usa el mismo delay del campo
          delayAfterSec: isLast || gallery.length === 1 ? delayAfterSec : delayAfterSec,
        });
      });
      continue;
    }

    const text = textForField(product, id);
    if (!text) continue;
    out.push({ text, media: null, kind: `product_${id}`, delayAfterSec });
  }

  return out;
}

async function insertWebFlowMessages(opts: {
  orgId: string;
  threadId: string;
  productId: string;
  baseMs: number;
  messages: FlowOutMessage[];
  askText?: string | null;
}) {
  const rows: any[] = [];
  let t = opts.baseMs;
  for (let i = 0; i < opts.messages.length; i++) {
    const m = opts.messages[i]!;
    rows.push({
      org_id: opts.orgId,
      thread_id: opts.threadId,
      direction: "out",
      text: m.text,
      media: m.media,
      wa_message_id: `web-flow-${opts.productId}-${m.kind}-${opts.baseMs}-${i}`,
      sent_at: new Date(t).toISOString(),
      source: "flow",
      raw: {
        channel: "web",
        kind: m.kind,
        productId: opts.productId,
        delayAfterSec: m.delayAfterSec,
        source: "flow",
      },
    });
    // Espera configurada antes del siguiente mensaje (mín. 30ms)
    t += Math.max(30, (m.delayAfterSec || 0) * 1000);
  }
  if (opts.askText) {
    rows.push({
      org_id: opts.orgId,
      thread_id: opts.threadId,
      direction: "out",
      text: opts.askText,
      media: null,
      wa_message_id: `web-flow-ask-${opts.productId}-${opts.baseMs}`,
      sent_at: new Date(t).toISOString(),
      source: "flow",
      raw: { channel: "web", kind: "product_ask", productId: opts.productId, source: "flow" },
    });
  }
  if (rows.length) {
    const { insertMessagesSafe } = await import("@/lib/message-insert.server");
    await insertMessagesSafe(rows as Record<string, unknown>[]);
  }
}

async function loadProduct(orgId: string, productId: string) {
  let { data: product, error } = await (supabaseAdmin as any)
    .from("products")
    .select(
      "id, name, description, price, stock, image_url, video_url, sku, badge, category, ai_observation, chat_ask_text, chat_flow, gallery_images, is_active",
    )
    .eq("org_id", orgId)
    .eq("id", productId)
    .maybeSingle();

  if (
    error?.message?.includes("chat_ask_text") ||
    error?.message?.includes("ai_observation") ||
    error?.code === "42703"
  ) {
    const legacy = await (supabaseAdmin as any)
      .from("products")
      .select(
        "id, name, description, price, stock, image_url, video_url, sku, badge, category, is_active",
      )
      .eq("org_id", orgId)
      .eq("id", productId)
      .maybeSingle();
    product = legacy.data
      ? {
          ...legacy.data,
          ai_observation: null,
          chat_ask_text: null,
          chat_flow: null,
          gallery_images: [],
        }
      : null;
    error = legacy.error;
  }

  if (error || !product || product.is_active === false) return null;
  return product;
}

function buildSnapshot(product: any, previous?: Record<string, unknown> | null) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price,
    stock: product.stock,
    image_url: product.image_url,
    video_url: product.video_url,
    sku: product.sku,
    badge: product.badge,
    category: product.category ?? null,
    ai_observation: product.ai_observation ?? null,
    chat_ask_text: product.chat_ask_text ?? null,
    source: "store_web",
    _lock: true,
    _catalog_search: null,
    _previous_product: previous || null,
  };
}

/**
 * Enfoca un producto en el hilo web: guarda snapshot para la IA,
 * envía ficha (mensajes individuales) + pregunta si cambió de producto.
 */
export async function focusStoreProduct(opts: {
  orgId: string;
  threadId: string;
  contactId: string;
  productId: string;
}): Promise<FocusStoreProductResult | null> {
  const { orgId, threadId, productId } = opts;
  const product = await loadProduct(orgId, productId);
  if (!product) return null;

  const { data: thread } = await supabaseAdmin
    .from("threads")
    .select("id, focused_product_id, focused_product_snapshot")
    .eq("id", threadId)
    .eq("org_id", orgId)
    .maybeSingle();

  const prevId = (thread as any)?.focused_product_id
    ? String((thread as any).focused_product_id)
    : null;
  const switched = prevId !== String(product.id);
  const oldSnap = (thread as any)?.focused_product_snapshot as Record<string, unknown> | null;
  const previousBlock =
    switched && oldSnap?.id && String(oldSnap.id) !== String(product.id)
      ? {
          id: oldSnap.id,
          name: oldSnap.name,
          price: oldSnap.price ?? null,
          sku: oldSnap.sku ?? null,
          description: oldSnap.description ?? null,
          category: oldSnap.category ?? null,
          ai_observation: oldSnap.ai_observation ?? null,
        }
      : (oldSnap?._previous_product as Record<string, unknown> | null) || null;
  const snapshot = buildSnapshot(product, previousBlock);

  await supabaseAdmin
    .from("threads")
    .update({
      focused_product_id: String(product.id),
      focused_product_snapshot: snapshot as any,
      focused_updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    } as any)
    .eq("id", threadId)
    .eq("org_id", orgId);

  if (switched) {
    console.info("[focusStoreProduct] cambio de producto → nueva observación", {
      orgId,
      threadId,
      from: prevId,
      to: product.id,
      toName: product.name,
      hasAiObservation: !!String(product.ai_observation || "").trim(),
      observationChars: String(product.ai_observation || "").trim().length,
      previousKept: previousBlock?.name || null,
    });
  }

  try {
    const { appendContactAskedProduct } = await import("@/lib/contact-inquiry.server");
    await appendContactAskedProduct({
      orgId,
      contactId: opts.contactId,
      productName: product.name,
      productId: String(product.id),
    });
  } catch {
    /* no bloquear foco */
  }

  try {
    const { startProductEntryFlow } = await import("@/lib/flow-trigger.server");
    const flowStart = await startProductEntryFlow({
      orgId,
      contactId: opts.contactId,
      productId: String(product.id),
    });
    if (!flowStart.started) {
      console.info("[focusStoreProduct] flujo producto no arrancó", {
        productId: product.id,
        message: flowStart.message,
      });
    }
  } catch (err) {
    console.warn(
      "[focusStoreProduct] startProductEntryFlow",
      err instanceof Error ? err.message : String(err),
    );
  }

  let introSent = false;
  const flow = (product.chat_flow as any) || {};
  const sendSpecs = flow.send_specs !== false;
  const sendAsk = flow.send_ask !== false;

  if (switched) {
    const now = Date.now();
    const ask =
      String(product.chat_ask_text || "").trim() ||
      "¿Dime qué te gustaría saber del producto?";
    await insertWebFlowMessages({
      orgId,
      threadId,
      productId: String(product.id),
      baseMs: now,
      messages: sendSpecs ? buildFlowMessages(product) : [],
      askText: sendAsk ? ask : null,
    });
    introSent = true;
  }

  import("@/lib/product-learning.server")
    .then(({ maybeQualifyProductLearning }) =>
      maybeQualifyProductLearning({
        orgId,
        threadId,
        contactId: opts.contactId,
      }),
    )
    .catch(() => {});

  return {
    productId: String(product.id),
    productName: String(product.name),
    switched,
    introSent,
    imageUrl: product.image_url ? String(product.image_url) : null,
    videoUrl: product.video_url ? String(product.video_url) : null,
    galleryImages: parseGalleryImages(product.gallery_images),
    price: product.price != null ? Number(product.price) : null,
    product,
  };
}

/**
 * Presenta producto en WhatsApp (o web): foco + mensajes del flujo en orden.
 */
export async function presentProductToThread(opts: {
  orgId: string;
  threadId: string;
  contactId?: string | null;
  productId: string;
  sessionId?: string | null;
  chatId?: string | null;
}): Promise<FocusStoreProductResult | null> {
  const product = await loadProduct(opts.orgId, opts.productId);
  if (!product) return null;

  const { data: existingThread } = await supabaseAdmin
    .from("threads")
    .select("focused_product_id, focused_product_snapshot")
    .eq("id", opts.threadId)
    .eq("org_id", opts.orgId)
    .maybeSingle();
  const oldSnap = (existingThread as any)?.focused_product_snapshot as Record<string, unknown> | null;
  const oldId = (existingThread as any)?.focused_product_id
    ? String((existingThread as any).focused_product_id)
    : oldSnap?.id
      ? String(oldSnap.id)
      : null;
  const previousBlock =
    oldId && oldId !== String(product.id) && oldSnap
      ? {
          id: oldSnap.id,
          name: oldSnap.name,
          price: oldSnap.price ?? null,
          sku: oldSnap.sku ?? null,
          description: oldSnap.description ?? null,
          category: oldSnap.category ?? null,
          ai_observation: oldSnap.ai_observation ?? null,
        }
      : (oldSnap?._previous_product as Record<string, unknown> | null) || null;

  const snapshot = buildSnapshot(product, previousBlock);
  await supabaseAdmin
    .from("threads")
    .update({
      focused_product_id: String(product.id),
      focused_product_snapshot: snapshot as any,
      focused_updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    } as any)
    .eq("id", opts.threadId)
    .eq("org_id", opts.orgId);

  try {
    const { appendContactAskedProduct } = await import("@/lib/contact-inquiry.server");
    await appendContactAskedProduct({
      orgId: opts.orgId,
      contactId: opts.contactId,
      productName: product.name,
      productId: String(product.id),
    });
  } catch {
    /* ignore */
  }

  try {
    const { startProductEntryFlow } = await import("@/lib/flow-trigger.server");
    const flowStart = await startProductEntryFlow({
      orgId: opts.orgId,
      contactId: opts.contactId,
      productId: String(product.id),
    });
    if (!flowStart.started) {
      console.info("[presentProductToThread] flujo producto no arrancó", {
        productId: product.id,
        contactId: opts.contactId || null,
        message: flowStart.message,
      });
    }
  } catch (err) {
    console.warn(
      "[presentProductToThread] startProductEntryFlow",
      err instanceof Error ? err.message : String(err),
    );
  }

  const now = Date.now();
  const flow = (product.chat_flow as any) || {};
  const sendSpecs = flow.send_specs !== false;
  const sendAsk = flow.send_ask !== false;
  const ask =
    String(product.chat_ask_text || "").trim() ||
    "¿Dime qué te gustaría saber del producto?";
  const flowMsgs = sendSpecs ? buildFlowMessages(product) : [];

  if (opts.sessionId && opts.chatId) {
    const cmds: any[] = [];
    let delayMs = 0;
    for (let i = 0; i < flowMsgs.length; i++) {
      const m = flowMsgs[i]!;
      if (m.media) {
        cmds.push({
          org_id: opts.orgId,
          session_id: opts.sessionId,
          type: "SEND_MEDIA",
          payload: {
            chatId: opts.chatId,
            mediaUrl: m.media.url,
            url: m.media.url,
            caption: "",
            kind: m.media.type,
            mediaType: m.media.type,
            dedupe_key: `present-${m.kind}-${product.id}-${now}`,
          },
          status: "pending",
          scheduled_for: delayMs ? new Date(Date.now() + delayMs).toISOString() : undefined,
        });
      } else if (m.text) {
        cmds.push({
          org_id: opts.orgId,
          session_id: opts.sessionId,
          type: "SEND_MESSAGE",
          payload: {
            chatId: opts.chatId,
            text: m.text,
            dedupeKey: `present-${m.kind}-${product.id}-${now}`,
          },
          status: "pending",
          scheduled_for: delayMs ? new Date(Date.now() + delayMs).toISOString() : undefined,
        });
      }
      delayMs += Math.max(0, (m.delayAfterSec || 0) * 1000);
      if ((m.delayAfterSec || 0) === 0) delayMs += 400; // pequeño gap si no hay espera
    }
    if (sendAsk) {
      cmds.push({
        org_id: opts.orgId,
        session_id: opts.sessionId,
        type: "SEND_MESSAGE",
        payload: {
          chatId: opts.chatId,
          text: ask,
          dedupeKey: `present-ask-${product.id}-${now}`,
        },
        status: "pending",
        scheduled_for: new Date(Date.now() + delayMs).toISOString(),
      });
    }
    if (cmds.length) await supabaseAdmin.from("engine_commands").insert(cmds as any);
  } else {
    await insertWebFlowMessages({
      orgId: opts.orgId,
      threadId: opts.threadId,
      productId: String(product.id),
      baseMs: now,
      messages: flowMsgs,
      askText: sendAsk ? ask : null,
    });
  }

  return {
    productId: String(product.id),
    productName: String(product.name),
    switched: true,
    introSent: true,
    imageUrl: product.image_url ? String(product.image_url) : null,
    videoUrl: product.video_url ? String(product.video_url) : null,
    galleryImages: parseGalleryImages(product.gallery_images),
    price: product.price != null ? Number(product.price) : null,
    product,
  };
}
