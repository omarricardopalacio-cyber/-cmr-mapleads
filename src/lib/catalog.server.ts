// ============================================================
// CATALOG INTEGRATION — server-side fetch helpers
// Llama al proyecto externo de catálogo (lovable de la pagina de productos)
// ============================================================
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CatalogConfig = {
  enabled: boolean;
  base_url: string;
  catalog_slug: string;
  api_token: string;
  send_media: boolean;
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
  attributes?: Record<string, unknown>;
};

function buildUrl(cfg: CatalogConfig, path: string): string {
  const base = cfg.base_url.replace(/\/+$/, "");
  const slug = cfg.catalog_slug.replace(/^\/+|\/+$/g, "");
  // Endpoint estándar: /api/public/catalog/:slug/...
  return `${base}/api/public/catalog/${slug}${path}`;
}

function headers(cfg: CatalogConfig): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (cfg.api_token) h["X-Catalog-Token"] = cfg.api_token;
  return h;
}

export async function getCatalogConfig(orgId: string): Promise<CatalogConfig | null> {
  const { data } = await (supabaseAdmin as any)
    .from("catalog_integrations")
    .select("enabled, base_url, catalog_slug, api_token, send_media")
    .eq("org_id", orgId)
    .maybeSingle();

  if (!data || !data.enabled || !data.base_url || !data.catalog_slug) return null;
  return data as CatalogConfig;
}

export async function pingCatalog(cfg: CatalogConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(buildUrl(cfg, "/health"), { headers: headers(cfg) });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const j = await res.json().catch(() => ({}));
    return { ok: true, message: j?.message || "Conectado" };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function searchCatalog(
  cfg: CatalogConfig,
  query: string,
  limit = 6,
): Promise<CatalogProduct[]> {
  const url = new URL(buildUrl(cfg, "/search"));
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString(), { headers: headers(cfg) });
  if (!res.ok) throw new Error(`Catalog search ${res.status}`);
  const j = (await res.json()) as { products?: CatalogProduct[] };
  return Array.isArray(j.products) ? j.products.slice(0, limit) : [];
}

export async function getCatalogProduct(
  cfg: CatalogConfig,
  productId: string,
): Promise<CatalogProduct | null> {
  const res = await fetch(buildUrl(cfg, `/product/${encodeURIComponent(productId)}`), {
    headers: headers(cfg),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { product?: CatalogProduct };
  return j.product ?? null;
}

/** Formato compacto del producto para inyectar en el contexto del system prompt */
export function formatProductForPrompt(p: CatalogProduct): string {
  const parts = [
    `- [${p.id}] ${p.name}`,
    p.price !== undefined ? `precio: ${p.currency ?? "$"} ${p.price}` : null,
    p.stock !== undefined && p.stock !== null ? `stock: ${p.stock}` : null,
    p.category ? `cat: ${p.category}` : null,
    p.url ? `link: ${p.url}` : null,
    p.image_url ? `img: ${p.image_url}` : null,
    p.description ? `desc: ${String(p.description).slice(0, 180)}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
