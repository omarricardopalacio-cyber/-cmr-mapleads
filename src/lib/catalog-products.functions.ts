import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "@/lib/org-helpers";

const PRODUCT_COLS =
  "id, name, description, price, stock, image_url, video_url, sku, badge, category, is_active, ai_observation, chat_ask_text, chat_flow, gallery_images, updated_at";

export const listStoreCatalogProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        q: z.string().max(120).optional(),
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
      })
      .optional()
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const q = String(data?.q || "").trim();
    const limit = data?.limit ?? 40;
    const offset = data?.offset ?? 0;

    let query = (supabaseAdmin as any)
      .from("products")
      .select(PRODUCT_COLS, { count: "exact" })
      .eq("org_id", orgId)
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (q) {
      query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,category.ilike.%${q}%`);
    }

    let { data: rows, error, count } = await query;

    if (error?.message?.includes("chat_ask") || error?.message?.includes("ai_observation") || error?.code === "42703") {
      const legacyCols =
        "id, name, description, price, stock, image_url, video_url, sku, badge, category, is_active, updated_at";
      let legacy = (supabaseAdmin as any)
        .from("products")
        .select(legacyCols, { count: "exact" })
        .eq("org_id", orgId)
        .order("name", { ascending: true })
        .range(offset, offset + limit - 1);
      if (q) legacy = legacy.or(`name.ilike.%${q}%,sku.ilike.%${q}%,category.ilike.%${q}%`);
      const res = await legacy;
      rows = (res.data || []).map((r: any) => ({
        ...r,
        ai_observation: null,
        chat_ask_text: null,
        chat_flow: { send_specs: true, send_ask: true },
        gallery_images: [],
      }));
      error = res.error;
      count = res.count;
    }

    if (error) throw new Error(error.message);
    const products = (rows ?? []).map((r: any) => ({
      ...r,
      gallery_images: (() => {
        const g = r.gallery_images;
        if (Array.isArray(g)) return g.filter((u: unknown) => typeof u === "string" && String(u).trim());
        if (typeof g === "string" && g.trim()) {
          try {
            const p = JSON.parse(g);
            if (Array.isArray(p)) return p.filter((u: unknown) => typeof u === "string" && String(u).trim());
          } catch {
            if (g.startsWith("http")) return [g.trim()];
          }
        }
        return [];
      })(),
      chat_flow: r.chat_flow && typeof r.chat_flow === "object" ? r.chat_flow : { send_specs: true, send_ask: true },
    }));
    return {
      products,
      total: count ?? 0,
      offset,
      limit,
      hasMore: offset + (products.length || 0) < (count ?? 0),
    };
  });

export const updateProductAiObservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        productId: z.string().uuid(),
        ai_observation: z.string().max(4000).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { error } = await (supabaseAdmin as any)
      .from("products")
      .update({
        ai_observation: data.ai_observation?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", orgId)
      .eq("id", data.productId);

    if (error?.message?.includes("ai_observation") || error?.code === "42703") {
      throw new Error(
        "Falta la columna ai_observation. Ejecuta la migración 20260727210000_products_ai_observation.sql",
      );
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateStoreProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        productId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(8000).nullable().optional(),
        price: z.number().nullable().optional(),
        stock: z.number().nullable().optional(),
        image_url: z.string().max(2000).nullable().optional(),
        video_url: z.string().max(2000).nullable().optional(),
        sku: z.string().max(80).nullable().optional(),
        badge: z.string().max(40).nullable().optional(),
        category: z.string().max(80).nullable().optional(),
        ai_observation: z.string().max(4000).nullable().optional(),
        chat_ask_text: z.string().max(300).nullable().optional(),
        gallery_images: z.array(z.string().max(2000)).max(12).optional(),
        chat_flow: z
          .object({
            send_specs: z.boolean().optional(),
            send_ask: z.boolean().optional(),
            send_price: z.boolean().optional(),
            send_stock: z.boolean().optional(),
            send_sku: z.boolean().optional(),
            send_badge: z.boolean().optional(),
            send_category: z.boolean().optional(),
            send_image: z.boolean().optional(),
            send_video: z.boolean().optional(),
            send_description: z.boolean().optional(),
            send_gallery: z.boolean().optional(),
            field_order: z
              .array(
                z.enum([
                  "name",
                  "badge",
                  "category",
                  "price",
                  "sku",
                  "stock",
                  "image",
                  "video",
                  "description",
                  "gallery",
                ]),
              )
              .max(20)
              .optional(),
          })
          .optional(),
        is_active: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const keys = [
      "name",
      "description",
      "price",
      "stock",
      "image_url",
      "video_url",
      "sku",
      "badge",
      "category",
      "ai_observation",
      "chat_ask_text",
      "gallery_images",
      "chat_flow",
      "is_active",
    ] as const;
    for (const k of keys) {
      if ((data as any)[k] !== undefined) (patch as any)[k] = (data as any)[k];
    }

    const { error } = await (supabaseAdmin as any)
      .from("products")
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", data.productId);

    if (error?.message?.includes("chat_ask") || error?.code === "42703") {
      throw new Error(
        "Faltan columnas de edición. Ejecuta en Supabase 20260727230000_products_chat_flow_edit.sql",
      );
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Sube imagen de producto a Storage y devuelve URL pública. */
export const uploadProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        productId: z.string().uuid(),
        fileName: z.string().min(1).max(180),
        contentBase64: z.string().min(32).max(8_000_000),
        contentType: z.string().min(3).max(80),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: prod } = await (supabaseAdmin as any)
      .from("products")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", data.productId)
      .maybeSingle();
    if (!prod) throw new Error("Producto no encontrado");

    const safeName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const path = `products/${orgId}/${data.productId}/${Date.now()}-${safeName}`;
    const buf = Buffer.from(data.contentBase64, "base64");
    if (buf.length > 6_000_000) throw new Error("Imagen demasiado grande (máx ~4.5 MB)");

    const { error: upErr } = await supabaseAdmin.storage
      .from("media")
      .upload(path, buf, {
        contentType: data.contentType || "image/jpeg",
        upsert: true,
      });
    if (upErr) throw new Error(upErr.message || "Error al subir imagen");

    const { data: pub } = supabaseAdmin.storage.from("media").getPublicUrl(path);
    if (!pub?.publicUrl) throw new Error("No se pudo obtener URL pública");
    return { url: pub.publicUrl, path };
  });
