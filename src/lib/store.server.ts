import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type StoreConfig = {
  org_id: string;
  store_token: string;
  brand_name: string;
  logo_url: string | null;
  primary_color: string;
  accent_color: string | null;
  social_title: string | null;
  social_description: string | null;
  social_image_url: string | null;
  enabled: boolean;
  meta_pixel_id: string | null;
  meta_capi_access_token: string | null;
  meta_pixel_enabled: boolean;
  custom_domain: string | null;
  google_analytics_id: string | null;
  google_site_verification: string | null;
  seo_title: string | null;
  seo_description: string | null;
  page_faq: string | null;
  page_terms: string | null;
  page_privacy: string | null;
  page_shipping: string | null;
};

const STORE_SELECT =
  "org_id, store_token, brand_name, logo_url, primary_color, accent_color, social_title, social_description, social_image_url, enabled, meta_pixel_id, meta_capi_access_token, meta_pixel_enabled, custom_domain, google_analytics_id, google_site_verification, seo_title, seo_description, page_faq, page_terms, page_privacy, page_shipping";

const STORE_SELECT_SOCIAL =
  "org_id, store_token, brand_name, logo_url, primary_color, accent_color, social_title, social_description, social_image_url, enabled";

const STORE_SELECT_BASIC =
  "org_id, store_token, brand_name, logo_url, primary_color, enabled";

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cur = rateBuckets.get(key);
  if (!cur || now > cur.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (cur.count >= limit) return false;
  cur.count += 1;
  return true;
}

export function newStoreToken(): string {
  return `stk_${randomBytes(24).toString("hex")}`;
}

export function newVisitorToken(): string {
  return `vis_${randomBytes(18).toString("hex")}`;
}

function normalizeStore(row: Record<string, unknown>): StoreConfig {
  return {
    org_id: String(row.org_id),
    store_token: String(row.store_token),
    brand_name: String(row.brand_name || "Mi Tienda"),
    logo_url: (row.logo_url as string) || null,
    primary_color: String(row.primary_color || "#0056AD"),
    accent_color: (row.accent_color as string) || "#FF2D95",
    social_title: (row.social_title as string) || null,
    social_description: (row.social_description as string) || null,
    social_image_url: (row.social_image_url as string) || null,
    enabled: row.enabled !== false,
    meta_pixel_id: (row.meta_pixel_id as string) || null,
    meta_capi_access_token: (row.meta_capi_access_token as string) || null,
    meta_pixel_enabled: row.meta_pixel_enabled === true,
    custom_domain: (row.custom_domain as string) || null,
    google_analytics_id: (row.google_analytics_id as string) || null,
    google_site_verification: (row.google_site_verification as string) || null,
    seo_title: (row.seo_title as string) || null,
    seo_description: (row.seo_description as string) || null,
    page_faq: (row.page_faq as string) || null,
    page_terms: (row.page_terms as string) || null,
    page_privacy: (row.page_privacy as string) || null,
    page_shipping: (row.page_shipping as string) || null,
  };
}

function missingCol(error: { message?: string; code?: string } | null | undefined) {
  if (!error) return false;
  const msg = String(error.message || "");
  return (
    error.code === "42703" ||
    /meta_pixel|custom_domain|google_|seo_|page_faq|page_terms|page_privacy|page_shipping|social_|accent_color/i.test(
      msg,
    )
  );
}

async function fetchStoreRow(opts: {
  orgId?: string;
  token?: string;
  domain?: string;
}): Promise<Record<string, unknown> | null> {
  const applyFilter = (q: any) => {
    if (opts.orgId) q = q.eq("org_id", opts.orgId);
    if (opts.token) q = q.eq("store_token", opts.token.trim());
    if (opts.domain) q = q.ilike("custom_domain", opts.domain.trim());
    return q.maybeSingle();
  };

  let res = await applyFilter((supabaseAdmin as any).from("store_configs").select(STORE_SELECT));
  if (res.error && missingCol(res.error)) {
    res = await applyFilter((supabaseAdmin as any).from("store_configs").select(STORE_SELECT_SOCIAL));
  }
  if (res.error && missingCol(res.error)) {
    if (opts.domain) return null;
    res = await applyFilter((supabaseAdmin as any).from("store_configs").select(STORE_SELECT_BASIC));
  }
  if (res.error || !res.data) return null;
  return res.data as Record<string, unknown>;
}

export async function resolveStoreByToken(token: string): Promise<StoreConfig | null> {
  if (!token?.trim()) return null;
  const data = await fetchStoreRow({ token });
  if (!data || data.enabled === false) return null;
  return normalizeStore(data);
}

export async function resolveStoreByCustomDomain(host: string): Promise<StoreConfig | null> {
  const domain = String(host || "")
    .split(":")[0]
    ?.trim()
    .toLowerCase();
  if (!domain || domain === "localhost") return null;
  const data = await fetchStoreRow({ domain });
  if (!data || data.enabled === false) return null;
  return normalizeStore(data);
}

export async function ensureStoreConfig(orgId: string): Promise<StoreConfig> {
  const existing = await fetchStoreRow({ orgId });
  if (existing) return normalizeStore(existing);

  const row = {
    org_id: orgId,
    store_token: newStoreToken(),
    brand_name: "Mi Tienda",
    primary_color: "#0056AD",
    accent_color: "#FF2D95",
    enabled: true,
  };
  const { data, error: insErr } = await (supabaseAdmin as any)
    .from("store_configs")
    .insert(row)
    .select(STORE_SELECT)
    .single();
  if (insErr || !data) {
    const { data: basic, error: e2 } = await (supabaseAdmin as any)
      .from("store_configs")
      .insert({
        org_id: orgId,
        store_token: row.store_token,
        brand_name: row.brand_name,
        primary_color: row.primary_color,
        enabled: true,
      })
      .select(STORE_SELECT_BASIC)
      .single();
    if (e2 || !basic) throw new Error(insErr?.message || e2?.message || "No se pudo crear store_configs");
    return normalizeStore(basic);
  }
  return normalizeStore(data);
}

export type StoreProductRow = {
  id: string;
  name: string;
  description?: string | null;
  price?: number | null;
  stock?: number | null;
  image_url?: string | null;
  video_url?: string | null;
  gallery_images?: string[] | null;
  slug?: string | null;
  sku?: string | null;
  badge?: string | null;
  category?: string | null;
  is_active?: boolean;
};

function parseProductGallery(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((u): u is string => typeof u === "string" && !!u.trim())
      .map((u) => u.trim())
      .slice(0, 12);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      return parseProductGallery(JSON.parse(raw));
    } catch {
      if (raw.startsWith("http")) return [raw.trim()];
    }
  }
  return [];
}

export async function listStoreProducts(
  orgId: string,
  opts?: { q?: string; limit?: number; offset?: number; id?: string; category?: string },
) {
  const limit = Math.min(Math.max(opts?.limit ?? 24, 1), 48);
  const offset = Math.max(opts?.offset ?? 0, 0);

  const selectWithGallery =
    "id, name, description, price, stock, image_url, video_url, gallery_images, slug, sku, badge, category, is_active";
  const selectWithCat =
    "id, name, description, price, stock, image_url, video_url, slug, sku, badge, category, is_active";
  const selectLegacy =
    "id, name, description, price, stock, image_url, video_url, slug, sku, badge, is_active";

  let query = (supabaseAdmin as any)
    .from("products")
    .select(selectWithGallery, { count: "exact" })
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (opts?.id) {
    query = (supabaseAdmin as any)
      .from("products")
      .select(selectWithGallery)
      .eq("org_id", orgId)
      .eq("id", opts.id)
      .limit(1);
  } else {
    if (opts?.q?.trim()) {
      const q = opts.q.trim().replace(/%/g, "");
      query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%,sku.ilike.%${q}%`);
    }
    if (opts?.category?.trim()) {
      query = query.eq("category", opts.category.trim());
    }
  }

  let { data, error, count } = await query;

  if (error && (error.message?.includes("gallery_images") || error.code === "42703")) {
    let qGal = (supabaseAdmin as any)
      .from("products")
      .select(selectWithCat, { count: "exact" })
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);
    if (opts?.id) {
      qGal = (supabaseAdmin as any)
        .from("products")
        .select(selectWithCat)
        .eq("org_id", orgId)
        .eq("id", opts.id)
        .limit(1);
    } else {
      if (opts?.q?.trim()) {
        const q = opts.q.trim().replace(/%/g, "");
        qGal = qGal.or(`name.ilike.%${q}%,description.ilike.%${q}%,sku.ilike.%${q}%`);
      }
      if (opts?.category?.trim()) qGal = qGal.eq("category", opts.category.trim());
    }
    const galRes = await qGal;
    data = galRes.data;
    error = galRes.error;
    count = galRes.count;
  }

  if (error && (error.message?.includes("category") || error.code === "42703")) {
    let q2 = (supabaseAdmin as any)
      .from("products")
      .select(selectLegacy, { count: "exact" })
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);
    if (opts?.id) {
      q2 = (supabaseAdmin as any)
        .from("products")
        .select(selectLegacy)
        .eq("org_id", orgId)
        .eq("id", opts.id)
        .limit(1);
    } else if (opts?.q?.trim()) {
      const q = opts.q.trim().replace(/%/g, "");
      q2 = q2.or(`name.ilike.%${q}%,description.ilike.%${q}%,sku.ilike.%${q}%`);
    }
    const legacy = await q2;
    data = legacy.data;
    error = legacy.error;
    count = legacy.count;
  }

  if (error) throw new Error(error.message);
  const products = ((data ?? []) as any[]).map((row) => ({
    ...row,
    gallery_images: parseProductGallery(row.gallery_images),
  })) as StoreProductRow[];
  const total = typeof count === "number" ? count : products.length;
  return {
    products,
    total,
    offset,
    limit,
    hasMore: opts?.id ? false : offset + products.length < total,
  };
}

export type StoreCategorySphere = {
  name: string;
  image_url: string | null;
  video_url: string | null;
  count: number;
};

/** Categorías + media representativa (imagen/video de un producto) para esferas. */
export async function listStoreCategories(orgId: string): Promise<StoreCategorySphere[]> {
  const { data, error } = await (supabaseAdmin as any)
    .from("products")
    .select("category, image_url, video_url")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .not("category", "is", null)
    .limit(2000);

  if (error) {
    if (error.message?.includes("category") || error.code === "42703") return [];
    throw new Error(error.message);
  }

  const map = new Map<string, StoreCategorySphere>();
  for (const row of data ?? []) {
    const name = String(row.category || "").trim();
    if (!name) continue;
    const cur = map.get(name);
    if (!cur) {
      map.set(name, {
        name,
        image_url: row.image_url || null,
        video_url: row.video_url || null,
        count: 1,
      });
    } else {
      cur.count += 1;
      if (!cur.video_url && row.video_url) cur.video_url = row.video_url;
      if (!cur.image_url && row.image_url) cur.image_url = row.image_url;
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}
