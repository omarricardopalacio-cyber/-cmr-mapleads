import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "@/lib/org-helpers";
import { ensureStoreConfig, newStoreToken } from "@/lib/store.server";

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
        logo_url: z.string().max(500).nullable().optional(),
        primary_color: z.string().min(4).max(20).optional(),
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
    if (data.enabled != null) patch.enabled = data.enabled;
    if (data.rotate_token) patch.store_token = newStoreToken();

    const { data: row, error } = await (supabaseAdmin as any)
      .from("store_configs")
      .update(patch)
      .eq("org_id", orgId)
      .select("org_id, store_token, brand_name, logo_url, primary_color, enabled")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
