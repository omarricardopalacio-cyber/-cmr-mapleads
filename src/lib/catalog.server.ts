// ============================================================
// CATALOG INTEGRATION — server-side fetch helpers
// Consulta directamente el Supabase PostgREST del catálogo externo.
// El catálogo expone: tabla `tenants` y tabla `master_products`
// accesibles con la publishable (anon) key vía PostgREST.
// ============================================================
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { expandSearchTerms, singularizeSpanish, correctSpelling, buildSearchVocabulary } from "./catalog-search";

export type CatalogConfig = {
  id: string;
  org_id: string;
  enabled: boolean;
  base_url: string;       // URL Supabase del catálogo: https://xxxx.supabase.co
  catalog_slug: string;   // slug de la bodega/tenant
  api_token: string;      // publishable (anon) key del catálogo
  send_media: boolean;
  tenants_table: string;  // default: tenants
  products_table: string; // default: master_products
  tenant_id?: string | null;
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

function extractProductAttributes(raw: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const attrs: Record<string, unknown> = {};
  for (const key of ["attributes", "specifications", "specs", "details", "caracteristicas", "metadata"]) {
    const value = raw[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(attrs, value as Record<string, unknown>);
    }
  }
  for (const key of ["marca", "brand", "material", "color", "talla", "tamano", "medidas", "temperatura", "voltaje", "garantia", "garantía"]) {
    if (raw[key] != null && raw[key] !== "") {
      attrs[key] = raw[key];
    }
  }
  return Object.keys(attrs).length ? attrs : undefined;
}

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
  if (cfg.tenant_id) return cfg.tenant_id;

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
    .update({ tenant_id: tenantId })
    .eq("id", cfg.id);

  return tenantId;
}

// ── public API ────────────────────────────────────────────────

export async function getCatalogConfig(orgId: string): Promise<CatalogConfig | null> {
  const { data } = await (supabaseAdmin as any)
    .from("catalog_integrations")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true) // Ensure it's active
    .limit(1)
    .maybeSingle();

  if (!data || !data.is_active || !data.supabase_url || !data.slug || !data.publishable_key) {
    return null;
  }

  return {
    id: data.id,
    org_id: orgId,
    enabled: data.is_active,
    base_url: data.supabase_url,
    catalog_slug: data.slug,
    api_token: data.publishable_key,
    send_media: data.send_media ?? true,
    tenants_table: data.tenants_table || "tenants",
    products_table: data.products_table || "master_products",
    tenant_id: data.tenant_id ?? null,
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
 * Busca productos en el catálogo sincronizado local.
 * Usa ilike sobre name, description y sku.
 */
export async function searchCatalog(
  cfg: CatalogConfig,
  query: string,
  limit = 6,
): Promise<CatalogProduct[]> {
  const { data: rows, error } = await (supabaseAdmin as any)
    .from("products")
    .select("*")
    .eq("org_id", cfg.org_id)
    .eq("is_active", true);

  if (error || !rows) {
    return [];
  }

  const products: CatalogProduct[] = rows.map((r: any) => {
    const raw = r.raw || {};
    return {
      id: String(r.id),
      name: String(r.name || ""),
      description: r.description || undefined,
      price: r.price ?? undefined,
      stock: r.stock ?? null,
      image_url: r.image_url || undefined,
      video_url: r.video_url || raw.video_url || raw.main_video_url || (Array.isArray(raw.videos) && raw.videos[0]?.url) || undefined,
      url: r.slug ? `${cfg.base_url.replace(/\/+$/, "").replace("supabase.co", "netlify.app")}/producto/${r.slug}` : undefined,
      sku: r.sku || undefined,
      badge: r.badge || undefined,
      attributes: extractProductAttributes(raw),
    };
  });

  const q = query.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!q) {
    return products.slice(0, limit);
  }

  const queryTokens = q.split(/\s+/).filter(Boolean);
  const vocab = buildSearchVocabulary(products);

  const scoredProducts = products.map((p) => {
    let score = 0;
    let nameHit = false;
    const nameClean = p.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const descClean = (p.description || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const skuClean = (p.sku || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 1. Coincidencia exacta de la frase
    if (nameClean.includes(q)) {
      score += 50;
      nameHit = true;
    } else if (descClean.includes(q)) {
      score += 20;
    }

    if (p.sku && skuClean.includes(q)) {
      score += 60;
      nameHit = true;
    }

    // 2. Coincidencia por tokens
    for (const token of queryTokens) {
      if (token.length < 2) continue;
      const sing = singularizeSpanish(token);
      const corr = correctSpelling(token, vocab);

      if (nameClean.includes(token)) {
        score += 10;
        nameHit = true;
      } else if (descClean.includes(token)) {
        score += 5;
      }

      if (p.sku && skuClean.includes(token)) {
        score += 15;
        nameHit = true;
      }

      // Coincidencia con el término singularizado (plurales -> singular)
      if (sing !== token) {
        if (nameClean.includes(sing)) {
          score += 8;
          nameHit = true;
        } else if (descClean.includes(sing)) {
          score += 4;
        }
      }

      // Coincidencia con corrección de typos
      if (corr !== token && corr !== sing) {
        if (nameClean.includes(corr)) {
          score += 6;
          nameHit = true;
        } else if (descClean.includes(corr)) {
          score += 3;
        }
      }
    }

    return { product: p, score, nameHit };
  });

  const matched = scoredProducts.filter((sp) => sp.score > 0);
  const nameMatches = matched.filter((sp) => sp.nameHit);
  const pool = nameMatches.length ? nameMatches : matched;

  return pool
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
    .map((sp) => sp.product)
    .slice(0, limit);
}

/**
 * Obtiene un producto por id del catálogo local.
 */
export async function getCatalogProduct(
  cfg: CatalogConfig,
  productId: string,
): Promise<CatalogProduct | null> {
  const { data: r, error } = await (supabaseAdmin as any)
    .from("products")
    .select("*")
    .eq("org_id", cfg.org_id)
    .eq("id", productId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !r) return null;

  const raw = r.raw || {};
  return {
    id: String(r.id),
    name: String(r.name || ""),
    description: r.description || undefined,
    price: r.price ?? undefined,
    stock: r.stock ?? null,
    image_url: r.image_url || undefined,
    video_url: r.video_url || raw.video_url || raw.main_video_url || (Array.isArray(raw.videos) && raw.videos[0]?.url) || undefined,
    sku: r.sku || undefined,
    badge: r.badge || undefined,
    attributes: extractProductAttributes(raw),
  };
}

/** Formato compacto del producto para inyectar en el contexto del system prompt */
export function formatProductForPrompt(p: CatalogProduct): string {
  const parts = [
    `ID_PARA_ENVIAR: "${p.id}"`,
    `Nombre: "${p.name}"`,
    p.price !== undefined ? `Precio: $${p.price}` : null,
    p.sku ? `SKU: ${p.sku}` : null,
    p.badge ? `Etiqueta: ${p.badge}` : null,
    p.url ? `Link: ${p.url}` : null,
    p.image_url ? `Imagen: ${p.image_url}` : null,
    p.video_url ? `Video: ${p.video_url}` : null,
    p.description ? `Desc: ${String(p.description).slice(0, 80)}...` : null,
  ];
  return `- ${parts.filter(Boolean).join(" | ")}`;
}
