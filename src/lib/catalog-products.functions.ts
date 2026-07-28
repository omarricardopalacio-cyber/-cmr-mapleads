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
    return {
      products: rows ?? [],
      total: count ?? 0,
      offset,
      limit,
      hasMore: offset + (rows?.length || 0) < (count ?? 0),
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
        image_url: z.string().max(1000).nullable().optional(),
        video_url: z.string().max(1000).nullable().optional(),
        sku: z.string().max(80).nullable().optional(),
        badge: z.string().max(40).nullable().optional(),
        category: z.string().max(80).nullable().optional(),
        ai_observation: z.string().max(4000).nullable().optional(),
        chat_ask_text: z.string().max(300).nullable().optional(),
        gallery_images: z.array(z.string().max(1000)).max(12).optional(),
        chat_flow: z
          .object({
            send_specs: z.boolean().optional(),
            send_ask: z.boolean().optional(),
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
