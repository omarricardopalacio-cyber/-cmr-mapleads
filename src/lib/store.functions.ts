import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "@/lib/org-helpers";
import { ensureStoreConfig, newStoreToken } from "@/lib/store.server";

const STORE_SELECT =
  "org_id, store_token, brand_name, logo_url, primary_color, accent_color, social_title, social_description, social_image_url, enabled";

export const getStoreSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
    const store = await ensureStoreConfig(orgId);
    return store;
  });

export const updateStoreSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        brand_name: z.string().min(1).max(80).optional(),
        logo_url: z.string().max(800).nullable().optional(),
        primary_color: z.string().min(4).max(20).optional(),
        accent_color: z.string().min(4).max(20).optional(),
        social_title: z.string().max(120).nullable().optional(),
        social_description: z.string().max(300).nullable().optional(),
        social_image_url: z.string().max(800).nullable().optional(),
        enabled: z.boolean().optional(),
        rotate_token: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    await ensureStoreConfig(orgId);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.brand_name != null) patch.brand_name = data.brand_name;
    if (data.logo_url !== undefined) patch.logo_url = data.logo_url;
    if (data.primary_color != null) patch.primary_color = data.primary_color;
    if (data.accent_color != null) patch.accent_color = data.accent_color;
    if (data.social_title !== undefined) patch.social_title = data.social_title;
    if (data.social_description !== undefined) patch.social_description = data.social_description;
    if (data.social_image_url !== undefined) patch.social_image_url = data.social_image_url;
    if (data.enabled != null) patch.enabled = data.enabled;
    if (data.rotate_token) patch.store_token = newStoreToken();

    let { data: row, error } = await (supabaseAdmin as any)
      .from("store_configs")
      .update(patch)
      .eq("org_id", orgId)
      .select(STORE_SELECT)
      .single();

    if (error && (error.message?.includes("social_") || error.message?.includes("accent_color"))) {
      const legacyPatch: Record<string, unknown> = {
        updated_at: patch.updated_at,
      };
      if (patch.brand_name !== undefined) legacyPatch.brand_name = patch.brand_name;
      if (patch.logo_url !== undefined) legacyPatch.logo_url = patch.logo_url;
      if (patch.primary_color !== undefined) legacyPatch.primary_color = patch.primary_color;
      if (patch.enabled !== undefined) legacyPatch.enabled = patch.enabled;
      if (patch.store_token !== undefined) legacyPatch.store_token = patch.store_token;
      const legacy = await (supabaseAdmin as any)
        .from("store_configs")
        .update(legacyPatch)
        .eq("org_id", orgId)
        .select("org_id, store_token, brand_name, logo_url, primary_color, enabled")
        .single();
      if (legacy.error) throw new Error(legacy.error.message);
      return {
        ...legacy.data,
        accent_color: data.accent_color ?? "#FF2D95",
        social_title: data.social_title ?? null,
        social_description: data.social_description ?? null,
        social_image_url: data.social_image_url ?? null,
        _warning:
          "Aplica la migración 20260727200000_store_syncro_social_category.sql para guardar Open Graph en la BD.",
      };
    }

    if (error) throw new Error(error.message);
    return row;
  });
