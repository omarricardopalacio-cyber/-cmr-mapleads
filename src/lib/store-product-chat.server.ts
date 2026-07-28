import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type FocusStoreProductResult = {
  productId: string;
  productName: string;
  switched: boolean;
  introSent: boolean;
  imageUrl: string | null;
  videoUrl: string | null;
  price: number | null;
};

function formatCop(price: number | null | undefined) {
  if (price == null || Number.isNaN(Number(price))) return "Consultar";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(price));
}

/**
 * Enfoca un producto en el hilo web: guarda snapshot para la IA,
 * envía imagen/video/ficha al chat y dispara la primera respuesta de IA si cambió.
 */
export async function focusStoreProduct(opts: {
  orgId: string;
  threadId: string;
  contactId: string;
  productId: string;
}): Promise<FocusStoreProductResult | null> {
  const { orgId, threadId, contactId, productId } = opts;

  let { data: product, error } = await (supabaseAdmin as any)
    .from("products")
    .select(
      "id, name, description, price, stock, image_url, video_url, sku, badge, category, ai_observation, is_active",
    )
    .eq("org_id", orgId)
    .eq("id", productId)
    .maybeSingle();

  if (error?.message?.includes("ai_observation") || error?.code === "42703") {
    const legacy = await (supabaseAdmin as any)
      .from("products")
      .select("id, name, description, price, stock, image_url, video_url, sku, badge, category, is_active")
      .eq("org_id", orgId)
      .eq("id", productId)
      .maybeSingle();
    product = legacy.data ? { ...legacy.data, ai_observation: null } : null;
    error = legacy.error;
  }

  if (error || !product || product.is_active === false) return null;

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

  const snapshot = {
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
    source: "store_web",
  };

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

  if (switched) {
    const now = Date.now();

    // Solo ficha corta en el chat (la descripción larga queda en el snapshot para la IA).
    const specs = [
      `📦 *${product.name}*`,
      product.badge ? `Etiqueta: ${product.badge}` : null,
      product.category ? `Categoría: ${product.category}` : null,
      `Precio: ${formatCop(product.price)}`,
      product.sku ? `SKU: ${product.sku}` : null,
      product.stock != null ? `Stock: ${product.stock}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    await supabaseAdmin.from("messages").insert({
      org_id: orgId,
      thread_id: threadId,
      direction: "out",
      text: specs,
      wa_message_id: `web-prod-info-${product.id}-${now}`,
      sent_at: new Date().toISOString(),
      raw: { channel: "web", kind: "product_info", productId: product.id },
    } as any);

    await supabaseAdmin.from("messages").insert({
      org_id: orgId,
      thread_id: threadId,
      direction: "out",
      text: "¿Dime qué te gustaría saber del producto?",
      wa_message_id: `web-prod-ask-${product.id}-${now}`,
      sent_at: new Date(Date.now() + 15).toISOString(),
      raw: { channel: "web", kind: "product_ask", productId: product.id },
    } as any);

    introSent = true;
  }

  return {
    productId: String(product.id),
    productName: String(product.name),
    switched,
    introSent,
    imageUrl: product.image_url ? String(product.image_url) : null,
    videoUrl: product.video_url ? String(product.video_url) : null,
    price: product.price != null ? Number(product.price) : null,
  };
}
