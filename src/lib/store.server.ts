import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type StoreConfig = {
  org_id: string;
  store_token: string;
  brand_name: string;
  logo_url: string | null;
  primary_color: string;
  enabled: boolean;
};

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

export async function resolveStoreByToken(token: string): Promise<StoreConfig | null> {
  if (!token?.trim()) return null;
  const { data, error } = await (supabaseAdmin as any)
    .from("store_configs")
    .select("org_id, store_token, brand_name, logo_url, primary_color, enabled")
    .eq("store_token", token.trim())
    .maybeSingle();
  if (error || !data || data.enabled === false) return null;
  return data as StoreConfig;
}

export async function ensureStoreConfig(orgId: string): Promise<StoreConfig> {
  const { data: existing } = await (supabaseAdmin as any)
    .from("store_configs")
    .select("org_id, store_token, brand_name, logo_url, primary_color, enabled")
    .eq("org_id", orgId)
    .maybeSingle();
  if (existing) return existing as StoreConfig;

  const row = {
    org_id: orgId,
    store_token: newStoreToken(),
    brand_name: "Mi Tienda",
    primary_color: "#FF6A00",
    enabled: true,
  };
  const { data, error } = await (supabaseAdmin as any)
    .from("store_configs")
    .insert(row)
    .select("org_id, store_token, brand_name, logo_url, primary_color, enabled")
    .single();
  if (error || !data) throw new Error(error?.message || "No se pudo crear store_configs");
  return data as StoreConfig;
}

export async function listStoreProducts(orgId: string, opts?: { q?: string; limit?: number; id?: string }) {
  const limit = Math.min(Math.max(opts?.limit ?? 48, 1), 100);
  let query = (supabaseAdmin as any)
    .from("products")
    .select("id, name, description, price, stock, image_url, video_url, slug, sku, badge, is_active")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(limit);

  if (opts?.id) {
    query = query.eq("id", opts.id);
  } else if (opts?.q?.trim()) {
    const q = opts.q.trim().replace(/%/g, "");
    query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%,sku.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
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
