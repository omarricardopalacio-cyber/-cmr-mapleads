import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "@/lib/org-helpers";

const PRODUCT_COLS =
  "id, name, description, price, stock, image_url, video_url, sku, badge, category, is_active, ai_observation, updated_at";

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
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (q) {
      query = query.or(
        `name.ilike.%${q}%,sku.ilike.%${q}%,category.ilike.%${q}%`,
      );
    }

    let { data: rows, error, count } = await query;

    if (error?.message?.includes("ai_observation") || error?.code === "42703") {
      const legacyCols = PRODUCT_COLS.replace(", ai_observation", "");
      let legacy = (supabaseAdmin as any)
        .from("products")
        .select(legacyCols, { count: "exact" })
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (q) {
        legacy = legacy.or(`name.ilike.%${q}%,sku.ilike.%${q}%,category.ilike.%${q}%`);
      }
      const res = await legacy;
      rows = (res.data || []).map((r: any) => ({ ...r, ai_observation: null }));
      error = res.error;
      count = res.count;
    }

    if (error) throw new Error(error.message);
    return {
      products: rows ?? [],
      total: count ?? 0,
      offset,
      limit,
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
        "Falta la columna ai_observation. Ejecuta en Supabase la migración 20260727210000_products_ai_observation.sql",
      );
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });
