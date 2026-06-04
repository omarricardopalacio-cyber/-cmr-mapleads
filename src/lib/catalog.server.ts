// ============================================================
// CATALOG INTEGRATION — server-side fetch helpers
// Consulta directamente el Supabase PostgREST del catálogo externo.
// El catálogo expone: tabla `tenants` y tabla `master_products`
// accesibles con la publishable (anon) key vía PostgREST.
// ============================================================
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CatalogConfig = {
  org_id: string;
  enabled: boolean;
  base_url: string;       // URL Supabase del catálogo: https://xxxx.supabase.co
  catalog_slug: string;   // slug de la bodega/tenant
  api_token: string;      // publishable (anon) key del catálogo
  send_media: boolean;
  tenants_table: string;  // default: tenants
  products_table: string; // default: master_products
  cached_tenant_id?: string | null;
};

export type CatalogProduct = {
  id: string;
  name: string;
  description?: string;
  price?: number | string;
  currency?: string;
  category?: string;
  image_url?: string;
  images?: string[];
  video_url?: string;
  stock?: number | null;
  url?: string;
  sku?: string;
  badge?: string;
  attributes?: Record<string, unknown>;
};

// ── helpers ──────────────────────────────────────────────────

function pgRestUrl(cfg: CatalogConfig, table: string): string {
  const base = cfg.base_url.replace(/\/+$/, "");
  return `${base}/rest/v1/${table}`;
}

function anonHeaders(cfg: CatalogConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "apikey": cfg.api_token,
    "Authorization": `Bearer ${cfg.api_token}`,
  };
}

// ── tenant resolver ───────────────────────────────────────────

async function resolveTenantId(cfg: CatalogConfig): Promise<string | null> {
  // Use cache if available
  if (cfg.cached_tenant_id) return cfg.cached_tenant_id;

  const table = cfg.tenants_table || "tenants";
  const url = new URL(pgRestUrl(cfg, table));
  url.searchParams.set("slug", `eq.${cfg.catalog_slug}`);
  url.searchParams.set("select", "id,slug,name");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), { headers: anonHeaders(cfg) });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Error resolviendo tenant [${res.status}]: ${txt.slice(0, 200)}`);
  }

  const rows: Array<{ id: string; slug: string; name?: string }> = await res.json();
  if (!rows.length) {
    throw new Error(`Slug "${cfg.catalog_slug}" no encontrado en tabla "${table}". Verifica el slug y los permisos RLS para anon.`);
  }

  const tenantId = rows[0].id;

  // Persist cache back to DB
  await (supabaseAdmin as any)
    .from("catalog_integrations")
    .update({ cached_tenant_id: tenantId })
    .eq("org_id", cfg.org_id);

  return tenantId;
}

// ── public API ────────────────────────────────────────────────

export async function getCatalogConfig(orgId: string): Promise<CatalogConfig | null> {
  const { data } = await (supabaseAdmin as any)
    .from("catalog_integrations")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();

  if (!data || !data.enabled || !data.base_url || !data.catalog_slug || !data.api_token) {
    return null;
  }

  return {
    org_id: orgId,
    enabled: data.enabled,
    base_url: data.base_url,
    catalog_slug: data.catalog_slug,
    api_token: data.api_token,
    send_media: data.send_media ?? true,
    tenants_table: data.tenants_table || "tenants",
    products_table: data.products_table || "master_products",
    cached_tenant_id: data.cached_tenant_id ?? null,
  } as CatalogConfig;
}

/**
 * Verifica la conexión:
 * 1. Resuelve el slug → tenant_id
 * 2. Cuenta productos activos
 */
export async function pingCatalog(cfg: CatalogConfig): Promise<{
  ok: boolean;
  message: string;
  productCount?: number;
  tenantId?: string;
}> {
  try {
    // Step 1: resolve tenant
    let tenantId: string;
    try {
      tenantId = (await resolveTenantId(cfg))!;
    } catch (e) {
      return {
        ok: false,
        message: `Paso 1 fallido (slug→tenant): ${(e as Error).message}`,
      };
    }

    // Step 2: count active products for this tenant
    const table = cfg.products_table || "master_products";
    const url = new URL(pgRestUrl(cfg, table));
    url.searchParams.set("tenant_id", `eq.${tenantId}`);
    url.searchParams.set("is_active", "eq.true");
    url.searchParams.set("select", "id");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      headers: {
        ...anonHeaders(cfg),
        "Prefer": "count=exact",
        "Range-Unit": "items",
        "Range": "0-0",
      },
    });

    if (!res.ok) {
      const txt = await res.text();
      return {
        ok: false,
        message: `Paso 2 fallido (contar productos) [${res.status}]: ${txt.slice(0, 200)}`,
        tenantId,
      };
    }

    // PostgREST returns Content-Range: 0-0/287
    const range = res.headers.get("content-range") || "";
    const total = parseInt(range.split("/")[1] ?? "0", 10);

    return {
      ok: true,
      message: `Conexión OK — ${isNaN(total) ? "?" : total} productos activos`,
      productCount: isNaN(total) ? undefined : total,
      tenantId,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/**
 * Busca productos en el catálogo externo vía PostgREST.
 * Usa ilike sobre name y (si existe) description.
 */
export async function searchCatalog(
  cfg: CatalogConfig,
  query: string,
  limit = 6,
): Promise<CatalogProduct[]> {
  const tenantId = await resolveTenantId(cfg);
  if (!tenantId) return [];

  const table = cfg.products_table || "master_products";
  const url = new URL(pgRestUrl(cfg, table));

  url.searchParams.set("tenant_id", `eq.${tenantId}`);
  url.searchParams.set("is_active", "eq.true");
  url.searchParams.set("limit", String(Math.min(limit, 10)));
  url.searchParams.set(
    "select",
    "id,name,slug,sku,badge,base_price,warehouse_stock,main_image_url,long_description,category_id",
  );

  if (query.trim()) {
    // PostgREST OR filter for name or description containing the query
    const q = query.trim().replace(/[%_]/g, "\\$&"); // escape wildcards
    url.searchParams.set("or", `(name.ilike.*${q}*,long_description.ilike.*${q}*)`);
  } else {
    // No query = return latest products
    url.searchParams.set("order", "id.desc");
  }

  const res = await fetch(url.toString(), { headers: anonHeaders(cfg) });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Catalog search [${res.status}]: ${txt.slice(0, 300)}`);
  }

  const rows: any[] = await res.json();

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name || ""),
    description: r.long_description || r.description || undefined,
    price: r.base_price ?? r.price ?? undefined,
    stock: r.warehouse_stock ?? r.stock ?? null,
    image_url: r.main_image_url || r.image_url || undefined,
    url: r.slug ? `${cfg.base_url.replace(/\/+$/, "").replace("supabase.co", "netlify.app")}/producto/${r.slug}` : undefined,
    sku: r.sku || undefined,
    badge: r.badge || undefined,
  }));
}

/**
 * Obtiene un producto por id del catálogo externo.
 */
export async function getCatalogProduct(
  cfg: CatalogConfig,
  productId: string,
): Promise<CatalogProduct | null> {
  const table = cfg.products_table || "master_products";
  const url = new URL(pgRestUrl(cfg, table));
  url.searchParams.set("id", `eq.${productId}`);
  url.searchParams.set("is_active", "eq.true");
  url.searchParams.set(
    "select",
    "id,name,slug,sku,badge,base_price,warehouse_stock,main_image_url,long_description",
  );
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), { headers: anonHeaders(cfg) });
  if (!res.ok) return null;

  const rows: any[] = await res.json();
  if (!rows.length) return null;

  const r = rows[0];
  return {
    id: String(r.id),
    name: String(r.name || ""),
    description: r.long_description || r.description || undefined,
    price: r.base_price ?? r.price ?? undefined,
    stock: r.warehouse_stock ?? r.stock ?? null,
    image_url: r.main_image_url || r.image_url || undefined,
    sku: r.sku || undefined,
    badge: r.badge || undefined,
  };
}

/** Formato compacto del producto para inyectar en el contexto del system prompt */
export function formatProductForPrompt(p: CatalogProduct): string {
  const parts = [
    `- [${p.id}] ${p.name}`,
    p.price !== undefined ? `precio: $${p.price}` : null,
    p.stock !== undefined && p.stock !== null ? `stock: ${p.stock}` : null,
    p.sku ? `sku: ${p.sku}` : null,
    p.badge ? `badge: ${p.badge}` : null,
    p.url ? `link: ${p.url}` : null,
    p.image_url ? `img: ${p.image_url}` : null,
    p.description ? `desc: ${String(p.description).slice(0, 180)}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
