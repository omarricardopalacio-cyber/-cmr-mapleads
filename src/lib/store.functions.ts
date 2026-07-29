import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "@/lib/org-helpers";
import { ensureStoreConfig, newStoreToken } from "@/lib/store.server";

const optionalText = z.string().max(20000).nullable().optional();

export const getStoreSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
    const store = await ensureStoreConfig(orgId);
    // Never send raw CAPI token in clear form beyond admin; mask if long
    return {
      ...store,
      meta_capi_access_token: store.meta_capi_access_token
        ? store.meta_capi_access_token.length > 8
          ? `${store.meta_capi_access_token.slice(0, 4)}…${store.meta_capi_access_token.slice(-4)}`
          : "••••"
        : null,
      _has_capi_token: Boolean(store.meta_capi_access_token),
    };
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
        meta_pixel_id: z.string().max(64).nullable().optional(),
        meta_capi_access_token: z.string().max(512).nullable().optional(),
        meta_pixel_enabled: z.boolean().optional(),
        custom_domain: z.string().max(200).nullable().optional(),
        google_analytics_id: z.string().max(40).nullable().optional(),
        google_site_verification: z.string().max(120).nullable().optional(),
        seo_title: z.string().max(120).nullable().optional(),
        seo_description: z.string().max(320).nullable().optional(),
        page_faq: optionalText,
        page_terms: optionalText,
        page_privacy: optionalText,
        page_shipping: optionalText,
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    await ensureStoreConfig(orgId);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    const set = (key: string, value: unknown) => {
      if (value !== undefined) patch[key] = value;
    };

    set("brand_name", data.brand_name);
    set("logo_url", data.logo_url);
    set("primary_color", data.primary_color);
    set("accent_color", data.accent_color);
    set("social_title", data.social_title);
    set("social_description", data.social_description);
    set("social_image_url", data.social_image_url);
    set("enabled", data.enabled);
    set("meta_pixel_id", data.meta_pixel_id === "" ? null : data.meta_pixel_id);
    set("meta_pixel_enabled", data.meta_pixel_enabled);
    set("custom_domain", data.custom_domain === "" ? null : data.custom_domain?.trim().toLowerCase() ?? data.custom_domain);
    set("google_analytics_id", data.google_analytics_id === "" ? null : data.google_analytics_id);
    set("google_site_verification", data.google_site_verification === "" ? null : data.google_site_verification);
    set("seo_title", data.seo_title === "" ? null : data.seo_title);
    set("seo_description", data.seo_description === "" ? null : data.seo_description);
    set("page_faq", data.page_faq);
    set("page_terms", data.page_terms);
    set("page_privacy", data.page_privacy);
    set("page_shipping", data.page_shipping);

    // Solo actualizar token CAPI si el admin envió un valor nuevo (no el masked)
    if (
      data.meta_capi_access_token !== undefined &&
      data.meta_capi_access_token !== null &&
      !String(data.meta_capi_access_token).includes("…") &&
      !String(data.meta_capi_access_token).includes("••••")
    ) {
      patch.meta_capi_access_token =
        data.meta_capi_access_token.trim() === "" ? null : data.meta_capi_access_token.trim();
    } else if (data.meta_capi_access_token === null) {
      patch.meta_capi_access_token = null;
    }

    if (data.rotate_token) patch.store_token = newStoreToken();

    const { data: row, error } = await (supabaseAdmin as any)
      .from("store_configs")
      .update(patch)
      .eq("org_id", orgId)
      .select(
        "org_id, store_token, brand_name, logo_url, primary_color, accent_color, social_title, social_description, social_image_url, enabled, meta_pixel_id, meta_pixel_enabled, custom_domain, google_analytics_id, google_site_verification, seo_title, seo_description, page_faq, page_terms, page_privacy, page_shipping",
      )
      .single();

    if (error) {
      if (/meta_pixel|custom_domain|google_|seo_|page_faq|42703/i.test(error.message || "")) {
        throw new Error(
          "Falta aplicar la migración 20260729120000_store_meta_domain_legal.sql en Supabase.",
        );
      }
      throw new Error(error.message);
    }
    return {
      ...row,
      meta_capi_access_token: null,
      _has_capi_token: Boolean(
        patch.meta_capi_access_token != null
          ? patch.meta_capi_access_token
          : (await ensureStoreConfig(orgId)).meta_capi_access_token,
      ),
    };
  });
