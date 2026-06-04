import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pingCatalog, searchCatalog, type CatalogConfig } from "./catalog.server";

async function getUserOrg(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("No organization");
  return data.org_id as string;
}

const DEFAULTS = {
  enabled: false,
  base_url: "",
  catalog_slug: "",
  api_token: "",
  send_media: true,
  tenants_table: "tenants",
  products_table: "master_products",
};

// ── GET ──────────────────────────────────────────────────────

export const getCatalogIntegration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await (supabaseAdmin as any)
      .from("catalog_integrations")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle();
    return { config: data ?? { org_id: orgId, ...DEFAULTS } };
  });

// ── SAVE ─────────────────────────────────────────────────────

const SaveSchema = z.object({
  enabled: z.boolean(),
  base_url: z.string().max(300).default(""),
  catalog_slug: z.string().max(200).default(""),
  api_token: z.string().max(600).default(""),
  send_media: z.boolean().default(true),
  tenants_table: z.string().max(100).default("tenants"),
  products_table: z.string().max(100).default("master_products"),
});

export const saveCatalogIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SaveSchema.parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    // Normalise base_url: strip trailing slash, ensure no /rest/v1 suffix
    const base_url = data.base_url.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
    const { error } = await (supabaseAdmin as any)
      .from("catalog_integrations")
      .upsert({
        org_id: orgId,
        ...data,
        base_url,
        // Reset cache when config changes so next query re-resolves tenant
        cached_tenant_id: null,
        updated_at: new Date().toISOString(),
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── TEST ─────────────────────────────────────────────────────

export const testCatalogIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await (supabaseAdmin as any)
      .from("catalog_integrations")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle();

    if (!data?.base_url || !data?.catalog_slug || !data?.api_token) {
      return {
        ok: false,
        message: "Completa URL de Supabase, slug y publishable key antes de probar",
      };
    }

    const cfg: CatalogConfig = {
      org_id: orgId,
      enabled: data.enabled,
      base_url: data.base_url,
      catalog_slug: data.catalog_slug,
      api_token: data.api_token,
      send_media: data.send_media ?? true,
      tenants_table: data.tenants_table || "tenants",
      products_table: data.products_table || "master_products",
      cached_tenant_id: null, // force fresh resolve on test
    };

    const ping = await pingCatalog(cfg);

    // Fetch a small sample of products if ping succeeded
    let sample: Array<{ id: string; name: string; price?: any }> = [];
    if (ping.ok) {
      try {
        const products = await searchCatalog(cfg, "", 3);
        sample = products.map((p) => ({ id: p.id, name: p.name, price: p.price }));
      } catch {
        // sample is optional, don't fail the test
      }
    }

    // Persist test result
    await (supabaseAdmin as any)
      .from("catalog_integrations")
      .update({
        last_test_at: new Date().toISOString(),
        last_test_ok: ping.ok,
        last_test_message: ping.message,
      })
      .eq("org_id", orgId);

    return {
      ok: ping.ok,
      message: ping.message,
      productCount: ping.productCount,
      sample,
    };
  });
