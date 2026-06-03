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
};

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

const SaveSchema = z.object({
  enabled: z.boolean(),
  base_url: z.string().max(300).default(""),
  catalog_slug: z.string().max(200).default(""),
  api_token: z.string().max(300).default(""),
  send_media: z.boolean().default(true),
});

export const saveCatalogIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SaveSchema.parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { error } = await (supabaseAdmin as any)
      .from("catalog_integrations")
      .upsert({ org_id: orgId, ...data, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testCatalogIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await (supabaseAdmin as any)
      .from("catalog_integrations")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle();

    if (!data?.base_url || !data?.catalog_slug) {
      return { ok: false, message: "Configura base_url y catalog_slug primero" };
    }

    const cfg = data as CatalogConfig;
    const ping = await pingCatalog(cfg);
    let sample: Array<{ id: string; name: string }> = [];

    if (ping.ok) {
      try {
        const products = await searchCatalog(cfg, "", 3);
        sample = products.map((p) => ({ id: String(p.id), name: String(p.name) }));
      } catch (e) {
        return {
          ok: false,
          message: `Conectado a /health pero /search falló: ${(e as Error).message}`,
        };
      }
    }

    await (supabaseAdmin as any)
      .from("catalog_integrations")
      .update({
        last_test_at: new Date().toISOString(),
        last_test_ok: ping.ok,
        last_test_message: ping.message,
      })
      .eq("org_id", orgId);

    return { ok: ping.ok, message: ping.message, sample };
  });
