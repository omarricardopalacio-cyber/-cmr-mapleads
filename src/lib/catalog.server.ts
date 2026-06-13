// ============================================================
// CATALOG INTEGRATION — server-side fetch helpers
// Consulta directamente el Supabase PostgREST del catálogo externo.
// El catálogo expone: tabla `tenants` y tabla `master_products`
// accesibles con la publishable (anon) key vía PostgREST.
// ============================================================
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  expandSearchTerms,
  singularizeSpanish,
  correctSpelling,
  buildSearchVocabulary,
} from "./catalog-search";

export type CatalogConfig = {
  id: string;
  org_id: string;
  enabled: boolean;
  base_url: string; // URL Supabase del catálogo: https://xxxx.supabase.co
  catalog_slug: string; // slug de la bodega/tenant
  api_token: string; // publishable (anon) key del catálogo
  send_media: boolean;
  tenants_table: string; // default: tenants
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

function extractProductAttributes(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const attrs: Record<string, unknown> = {};
  for (const key of [
    "attributes",
    "specifications",
    "specs",
    "details",
    "caracteristicas",
    "metadata",
  ]) {
    const value = raw[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(attrs, value as Record<string, unknown>);
    }
  }
  for (const key of [
    "marca",
    "brand",
    "material",
    "color",
    "talla",
    "tamano",
    "medidas",
    "temperatura",
    "voltaje",
    "garantia",
    "garantía",
  ]) {
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
    apikey: cfg.api_token,
    Authorization: `Bearer ${cfg.api_token}`,
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
    throw new Error(
      `Slug "${cfg.catalog_slug}" no encontrado en tabla "${table}". Verifica el slug y los permisos RLS para anon.`,
    );
  }

  const tenantId = rows[0].id;

  // Persist cache back to DB
  await (supabaseAdmin as any)
    .from("catalog_integrations")
    .update({ tenant_id: tenantId })
    .eq("id", cfg.id);

  return tenantId;
}

// ── cache ─────────────────────────────────────────────────
const externalProductsCache = new Map<string, { products: CatalogProduct[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const searchResultsCache = new Map<string, { products: CatalogProduct[]; timestamp: number }>();
const inFlightSearches = new Map<string, Promise<CatalogProduct[]>>();
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;

function getCacheKey(cfg: CatalogConfig): string {
  return `${cfg.org_id}:${cfg.catalog_slug}:${cfg.api_token}`;
}

function clearProductsCache(cfg: CatalogConfig): void {
  externalProductsCache.delete(getCacheKey(cfg));
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
        Prefer: "count=exact",
        "Range-Unit": "items",
        Range: "0-0",
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

function mapProductRow(r: any, cfg: CatalogConfig): CatalogProduct {
  const raw = r.raw || r;
  const imageFromRaw =
    raw.main_image_url ||
    raw.image_url ||
    (Array.isArray(raw.images) && (raw.images[0]?.url || raw.images[0]));
  return {
    id: String(r.id ?? r.external_id),
    name: String(r.name || r.title || ""),
    description: r.description || raw.long_description || raw.description || undefined,
    price: r.price ?? raw.base_price ?? undefined,
    stock: r.stock ?? raw.warehouse_stock ?? null,
    image_url: r.image_url || imageFromRaw || undefined,
    video_url:
      r.video_url ||
      raw.video_url ||
      raw.main_video_url ||
      (Array.isArray(raw.videos) && raw.videos[0]?.url) ||
      undefined,
    url: r.slug
      ? `${cfg.base_url.replace(/\/+$/, "").replace("supabase.co", "netlify.app")}/producto/${r.slug}`
      : undefined,
    sku: r.sku || raw.sku || undefined,
    badge: r.badge || raw.badge || undefined,
    attributes: extractProductAttributes(raw),
  };
}

async function loadLocalProducts(cfg: CatalogConfig): Promise<CatalogProduct[]> {
  const { data: rows, error } = await (supabaseAdmin as any)
    .from("products")
    .select("*")
    .eq("org_id", cfg.org_id)
    .eq("is_active", true);

  if (error || !rows) {
    return [];
  }

  return rows.map((r: any) => mapProductRow(r, cfg));
}

async function loadExternalProducts(cfg: CatalogConfig): Promise<CatalogProduct[]> {
  try {
    // Check cache first
    const cacheKey = getCacheKey(cfg);
    const cached = externalProductsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(
        `[catalog] Usando caché de productos externos: ${cached.products.length} productos`,
      );
      return cached.products;
    }

    const tenantId = await resolveTenantId(cfg);
    if (!tenantId) return [];
    const table = cfg.products_table || "master_products";
    const url = new URL(pgRestUrl(cfg, table));
    url.searchParams.set("tenant_id", `eq.${tenantId}`);
    url.searchParams.set("is_active", "eq.true");
    url.searchParams.set("select", "*");
    // Aumentar a 500 productos para mejor cobertura de búsquedas
    const res = await fetch(url.toString(), {
      headers: { ...anonHeaders(cfg), "Range-Unit": "items", Range: "0-499" },
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(
        `[catalog.search] catálogo externo respondió ${res.status}: ${body.slice(0, 180)}`,
      );
      return [];
    }
    const rows: any[] = await res.json();
    const products = rows.map((r) => mapProductRow(r, cfg));

    // Cache the results
    externalProductsCache.set(cacheKey, { products, timestamp: Date.now() });
    console.log(`[catalog] Cargados y cacheados ${products.length} productos externos`);

    return products;
  } catch (err) {
    console.warn(
      "[catalog.search] fallback externo falló",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

export function rankProductsMeta(
  products: CatalogProduct[],
  query: string,
  limit: number,
): { results: CatalogProduct[]; hasNameMatch: boolean } {
  const q = query
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!q) return { results: products.slice(0, limit), hasNameMatch: false };

  const STOP_WORDS = new Set([
    "de",
    "del",
    "para",
    "con",
    "en",
    "un",
    "una",
    "unos",
    "unas",
    "el",
    "la",
    "los",
    "las",
    "y",
    "o",
    "que",
    "mueble",
    "producto",
  ]);
  const SEMANTIC_GROUPS = [
    ["zapatero", "zapato", "calzado"],
    ["organizador", "organizar", "orden"],
    ["silla", "asiento"],
    ["almohada", "cojin"],
  ];
  const rawTokens = q.split(/\s+/).filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
  const vocab = buildSearchVocabulary(products);
  console.log(
    `[DEBUG rankProductsMeta] query="${query}", q normalized="${q}", rawTokens=${JSON.stringify(rawTokens)}, total products=${products.length}`,
  );

  const normalizedTokens = rawTokens.map((token) =>
    correctSpelling(singularizeSpanish(token), vocab),
  );
  const queryTokens = Array.from(
    new Set(
      normalizedTokens.flatMap((token) => {
        const group = SEMANTIC_GROUPS.find((items) => items.includes(token));
        return group ?? [token];
      }),
    ),
  );

  // NOTA: El filtro de exclusión por palabras clave fue eliminado porque causaba
  // que productos legítimos (ej: "FUNDA ALMOHADA", "ALMOHADA C/FUNDA") fueran
  // rechazados permanentemente al buscar "almohada". El MIN_SCORE=15 ya es
  // suficiente para filtrar productos irrelevantes: una "BOLSA DE ROPA" al buscar
  // "almohada" obtendría score=9 (solo match en descripción), que queda bajo el umbral.

  const scoredProducts = products.map((p) => {
    let score = 0;
    let nameHit = false;
    const nameClean = p.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const descClean = (p.description || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const skuClean = (p.sku || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    // 1. Coincidencia exacta de la frase original
    if (nameClean.includes(q)) {
      score += 50;
      nameHit = true;
    }

    // 2. Coincidencia por conceptos normalizados. Un match singular/plural en
    // nombre es una señal fuerte por sigo sola y no puede quedar bajo el umbral.
    for (const token of queryTokens) {
      if (token.length < 2) continue;
      if (nameClean.includes(token)) {
        score += 24;
        nameHit = true;
      } else if (descClean.includes(token)) {
        score += 9;
      }
      if (p.sku && skuClean.includes(token)) {
        score += 35;
        nameHit = true;
      }
    }

    return { product: p, score, nameHit };
  });

  // FILTRO 1: Rechazar scores muy bajos (umbral mínimo)
  const MIN_SCORE = 15;
  const matched = scoredProducts.filter((sp) => sp.score >= MIN_SCORE);

  if (!matched.length) {
    // Si no hay match fuerte, permitir scores >= 10 pero solo name-matches
    const weakMatches = scoredProducts.filter((sp) => sp.score >= 10 && sp.nameHit);
    const results = weakMatches
      .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
      .map((sp) => sp.product)
      .slice(0, limit);
    console.log(
      `[DEBUG rankProductsMeta] matched=${matched.length}, weakMatches=${weakMatches.length}, returned=${results.length}`,
    );
    return { results, hasNameMatch: weakMatches.length > 0 };
  }

  const nameMatches = matched.filter((sp) => sp.nameHit);

  // FILTRO 2: Priorizar name-matches si hay suficientes
  let pool = matched;
  if (nameMatches.length >= Math.ceil(limit / 2)) {
    // Si hay al menos 3 matches en nombre, usar solo esos
    pool = nameMatches;
  } else if (nameMatches.length > 0) {
    // Si hay pocos matches en nombre, combinar pero priorizar
    pool = [...nameMatches];
    const otherMatches = matched.filter((sp) => !sp.nameHit);
    for (const m of otherMatches) {
      if (pool.length < limit) pool.push(m);
    }
  }

  console.log(
    `[DEBUG rankProductsMeta] matched=${matched.length}, nameMatches=${nameMatches.length}, pool=${pool.length}`,
  );
  if (matched.length > 0) {
    console.log(
      `[DEBUG rankProductsMeta] scored samples: ${matched
        .slice(0, 5)
        .map((sp) => `${sp.product.name}(score=${sp.score})`)
        .join(", ")}`,
    );
  }

  const results = pool
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
    .map((sp) => sp.product)
    .slice(0, limit);

  return { results, hasNameMatch: nameMatches.length > 0 };
}

function mergeCatalogProduct(primary: CatalogProduct, secondary: CatalogProduct): CatalogProduct {
  return {
    ...primary,
    ...Object.fromEntries(
      Object.entries(secondary).filter(
        ([_, value]) =>
          value !== undefined &&
          value !== null &&
          !(typeof value === "string" && value.trim() === ""),
      ),
    ),
  } as CatalogProduct;
}

/**
 * Busca productos usando el catálogo local y el catálogo externo en conjunto,
 * unificando resultados por ID y ordenando sobre el conjunto completo.
 */
export async function searchCatalog(
  cfg: CatalogConfig,
  query: string,
  limit = 6,
): Promise<CatalogProduct[]> {
  const q = query.trim();
  const normalizedQuery = q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
  const cacheKey = `${getCacheKey(cfg)}:${normalizedQuery}`;
  const cached = searchResultsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL_MS) {
    return cached.products.slice(0, limit);
  }

  let pending = inFlightSearches.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const [localProducts, externalProducts] = await Promise.all([
        loadLocalProducts(cfg),
        q ? loadExternalProducts(cfg) : Promise.resolve([]),
      ]);
      const byId = new Map<string, CatalogProduct>();
      for (const product of externalProducts) {
        byId.set(product.id, product);
      }
      for (const product of localProducts) {
        const existing = byId.get(product.id);
        byId.set(product.id, existing ? mergeCatalogProduct(existing, product) : product);
      }
      const unifiedProducts = Array.from(byId.values());
      const ranked = rankProductsMeta(unifiedProducts, query, unifiedProducts.length).results;
      searchResultsCache.set(cacheKey, { products: ranked, timestamp: Date.now() });
      return ranked;
    })().finally(() => inFlightSearches.delete(cacheKey));
    inFlightSearches.set(cacheKey, pending);
  }

  return (await pending).slice(0, limit);
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
    video_url:
      r.video_url ||
      raw.video_url ||
      raw.main_video_url ||
      (Array.isArray(raw.videos) && raw.videos[0]?.url) ||
      undefined,
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
