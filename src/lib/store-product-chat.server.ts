import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  isFlowFieldEnabled,
  normalizeFlowFieldOrder,
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

function linesForField(product: any, id: FlowFieldId): string[] {
  switch (id) {
    case "name":
      return [`📦 *${product.name}*`];
    case "badge":
      return product.badge ? [`Etiqueta: ${product.badge}`] : [];
    case "category":
      return product.category ? [`Categoría: ${product.category}`] : [];
    case "price":
      return [`Precio: ${formatCop(product.price)}`];
    case "sku":
      return product.sku ? [`SKU: ${product.sku}`] : [];
    case "stock":
      return product.stock != null ? [`Stock: ${product.stock}`] : [];
    case "image":
      return product.image_url ? [`Imagen: ${product.image_url}`] : [];
    case "video":
      return product.video_url ? [`Video: ${product.video_url}`] : [];
    case "description":
      return product.description
        ? [`Descripción: ${String(product.description).slice(0, 800)}`]
        : [];
    case "gallery": {
      const gallery = parseGalleryImages(product.gallery_images);
      if (!gallery.length) return [];
      return [`Galería (${gallery.length}):`, ...gallery.map((u, i) => `${i + 1}. ${u}`)];
    }
    default:
      return [];
  }
}

function buildSpecs(product: any) {
  const flow = (product.chat_flow as Record<string, unknown>) || {};
  const order = normalizeFlowFieldOrder(flow.field_order);
  const lines: string[] = [];
  for (const id of order) {
    if (!isFlowFieldEnabled(flow, id)) continue;
    lines.push(...linesForField(product, id));
  }
  return lines.join("\n");
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

  if (error?.message?.includes("chat_ask_text") || error?.message?.includes("ai_observation") || error?.code === "42703") {
    const legacy = await (supabaseAdmin as any)
      .from("products")
      .select(
        "id, name, description, price, stock, image_url, video_url, sku, badge, category, is_active",
      )
      .eq("org_id", orgId)
      .eq("id", productId)
      .maybeSingle();
    product = legacy.data
      ? { ...legacy.data, ai_observation: null, chat_ask_text: null, chat_flow: null, gallery_images: [] }
      : null;
    error = legacy.error;
  }

  if (error || !product || product.is_active === false) return null;
  return product;
}

function buildSnapshot(product: any) {
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
  };
}

/**
 * Enfoca un producto en el hilo web: guarda snapshot para la IA,
 * envía ficha corta + pregunta si cambió de producto.
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
  const snapshot = buildSnapshot(product);

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

  let introSent = false;
  const flow = (product.chat_flow as any) || {};
  // Si send_specs === false, no envía ficha. Si no está, envía con campos individuales.
  const sendSpecs = flow.send_specs !== false;
  const sendAsk = flow.send_ask !== false;

  if (switched) {
    const now = Date.now();
    if (sendSpecs) {
      await supabaseAdmin.from("messages").insert({
        org_id: orgId,
        thread_id: threadId,
        direction: "out",
        text: buildSpecs(product),
        wa_message_id: `web-prod-info-${product.id}-${now}`,
        sent_at: new Date().toISOString(),
        raw: { channel: "web", kind: "product_info", productId: product.id },
      } as any);
    }

    if (sendAsk) {
      await supabaseAdmin.from("messages").insert({
        org_id: orgId,
        thread_id: threadId,
        direction: "out",
        text:
          String(product.chat_ask_text || "").trim() ||
          "¿Dime qué te gustaría saber del producto?",
        wa_message_id: `web-prod-ask-${product.id}-${now}`,
        sent_at: new Date(Date.now() + 15).toISOString(),
        raw: { channel: "web", kind: "product_ask", productId: product.id },
      } as any);
    }

    introSent = true;
  }

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
 * Presenta producto en WhatsApp (o web): foco + imagen + video + ficha + pregunta.
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

  const snapshot = buildSnapshot(product);
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

  const now = Date.now();
  const ask =
    String(product.chat_ask_text || "").trim() ||
    "¿Dime qué te gustaría saber del producto?";
  const specs = buildSpecs(product);

  // Canal WhatsApp: encolar media + textos
  if (opts.sessionId && opts.chatId) {
    const cmds: any[] = [];
    if (product.image_url) {
      cmds.push({
        org_id: opts.orgId,
        session_id: opts.sessionId,
        type: "SEND_MEDIA",
        payload: {
          chatId: opts.chatId,
          mediaUrl: product.image_url,
          url: product.image_url,
          caption: product.name,
          kind: "image",
          mediaType: "image",
          dedupe_key: `present-img-${product.id}-${now}`,
        },
        status: "pending",
      });
    }
    if (product.video_url) {
      cmds.push({
        org_id: opts.orgId,
        session_id: opts.sessionId,
        type: "SEND_MEDIA",
        payload: {
          chatId: opts.chatId,
          mediaUrl: product.video_url,
          url: product.video_url,
          caption: product.name,
          kind: "video",
          mediaType: "video",
          dedupe_key: `present-vid-${product.id}-${now}`,
        },
        status: "pending",
        scheduled_for: new Date(Date.now() + 1500).toISOString(),
      });
    }
    cmds.push({
      org_id: opts.orgId,
      session_id: opts.sessionId,
      type: "SEND_MESSAGE",
      payload: {
        chatId: opts.chatId,
        text: specs,
        dedupeKey: `present-specs-${product.id}-${now}`,
      },
      status: "pending",
      scheduled_for: new Date(Date.now() + 2500).toISOString(),
    });
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
      scheduled_for: new Date(Date.now() + 3500).toISOString(),
    });
    if (cmds.length) await supabaseAdmin.from("engine_commands").insert(cmds as any);
  } else {
    // Canal web: mensajes en BD
    if (product.image_url) {
      await supabaseAdmin.from("messages").insert({
        org_id: opts.orgId,
        thread_id: opts.threadId,
        direction: "out",
        text: null,
        media: { url: product.image_url, type: "image", mimeType: "image/jpeg" },
        wa_message_id: `web-present-img-${product.id}-${now}`,
        sent_at: new Date().toISOString(),
        raw: { channel: "web", kind: "product_image", productId: product.id },
      } as any);
    }
    await supabaseAdmin.from("messages").insert({
      org_id: opts.orgId,
      thread_id: opts.threadId,
      direction: "out",
      text: specs,
      wa_message_id: `web-present-info-${product.id}-${now}`,
      sent_at: new Date(Date.now() + 10).toISOString(),
      raw: { channel: "web", kind: "product_info", productId: product.id },
    } as any);
    await supabaseAdmin.from("messages").insert({
      org_id: opts.orgId,
      thread_id: opts.threadId,
      direction: "out",
      text: ask,
      wa_message_id: `web-present-ask-${product.id}-${now}`,
      sent_at: new Date(Date.now() + 20).toISOString(),
      raw: { channel: "web", kind: "product_ask", productId: product.id },
    } as any);
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
