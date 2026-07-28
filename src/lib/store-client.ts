/** Cliente storefront (catálogo + chat web). */

export type StoreConfigPublic = {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  socialTitle: string | null;
  socialDescription: string | null;
  socialImageUrl: string | null;
  orgId: string;
};

export type StoreProduct = {
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
};

export type StoreCategorySphere = {
  name: string;
  image_url: string | null;
  video_url: string | null;
  count: number;
};

function headers(storeToken: string, visitorToken?: string) {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Store-Token": storeToken,
  };
  if (visitorToken) h["X-Visitor-Token"] = visitorToken;
  return h;
}

export async function fetchStoreConfig(storeToken: string): Promise<StoreConfigPublic> {
  const res = await fetch(`/api/public/store/config?token=${encodeURIComponent(storeToken)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Config error");
  const data = await res.json();
  return {
    brandName: data.brandName,
    logoUrl: data.logoUrl ?? null,
    primaryColor: data.primaryColor || "#0056AD",
    accentColor: data.accentColor || "#FF2D95",
    socialTitle: data.socialTitle ?? null,
    socialDescription: data.socialDescription ?? null,
    socialImageUrl: data.socialImageUrl ?? null,
    orgId: data.orgId,
  };
}

export async function fetchStoreCategories(storeToken: string): Promise<StoreCategorySphere[]> {
  const u = new URL("/api/public/store/products", window.location.origin);
  u.searchParams.set("token", storeToken);
  u.searchParams.set("meta", "1");
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Categories error");
  const data = await res.json();
  return data.categories ?? [];
}

export async function fetchStoreProducts(
  storeToken: string,
  opts?: { q?: string; id?: string; category?: string; limit?: number; offset?: number },
): Promise<{ products: StoreProduct[]; hasMore: boolean; total: number; offset: number }> {
  const u = new URL("/api/public/store/products", window.location.origin);
  u.searchParams.set("token", storeToken);
  if (opts?.q) u.searchParams.set("q", opts.q);
  if (opts?.id) u.searchParams.set("id", opts.id);
  if (opts?.category) u.searchParams.set("category", opts.category);
  if (opts?.limit != null) u.searchParams.set("limit", String(opts.limit));
  if (opts?.offset != null) u.searchParams.set("offset", String(opts.offset));
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Products error");
  const data = await res.json();
  // Compat: API antigua devolvía { products: [] }
  if (Array.isArray(data.products) && data.hasMore == null && data.total == null) {
    return { products: data.products, hasMore: false, total: data.products.length, offset: 0 };
  }
  return {
    products: data.products ?? [],
    hasMore: !!data.hasMore,
    total: data.total ?? (data.products?.length || 0),
    offset: data.offset ?? 0,
  };
}

export async function openChatSession(
  storeToken: string,
  opts?: {
    visitorToken?: string;
    productId?: string;
    productName?: string;
    displayName?: string;
    phone?: string;
    startProduct?: boolean;
  },
) {
  const res = await fetch("/api/public/store/chat/session", {
    method: "POST",
    headers: headers(storeToken),
    body: JSON.stringify({
      visitorToken: opts?.visitorToken,
      productId: opts?.productId,
      productName: opts?.productName,
      displayName: opts?.displayName,
      phone: opts?.phone,
      startProduct: opts?.startProduct,
    }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Session error");
  return res.json() as Promise<{
    visitorToken: string;
    threadId: string;
    productHint: string | null;
    productFocus: {
      productId: string;
      productName: string;
      switched: boolean;
      introSent: boolean;
      imageUrl: string | null;
      videoUrl: string | null;
      galleryImages?: string[];
      price: number | null;
    } | null;
    brandName: string;
    primaryColor: string;
  }>;
}

export async function fetchChatMessages(storeToken: string, visitorToken: string, since?: string) {
  const u = new URL("/api/public/store/chat/messages", window.location.origin);
  if (since) u.searchParams.set("since", since);
  const res = await fetch(u.toString(), { headers: headers(storeToken, visitorToken) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Messages error");
  return res.json() as Promise<{
    messages: Array<{
      id: string;
      direction: "in" | "out";
      text: string | null;
      media: unknown;
      sent_at: string;
    }>;
    threadId: string;
    aiEnabled: boolean;
  }>;
}

export async function sendChatMessage(storeToken: string, visitorToken: string, text: string) {
  const res = await fetch("/api/public/store/chat/messages", {
    method: "POST",
    headers: headers(storeToken, visitorToken),
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Send error");
  return res.json();
}

export function visitorStorageKey(storeToken: string) {
  return `maple_store_visitor_${storeToken}`;
}

export function leadStorageKey(storeToken: string) {
  return `maple_store_lead_${storeToken}`;
}

export type StoreLead = { name: string; phone: string };

export function loadStoreLead(storeToken: string): StoreLead | null {
  try {
    const raw = localStorage.getItem(leadStorageKey(storeToken));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoreLead;
    if (!parsed?.name?.trim() || !parsed?.phone?.trim()) return null;
    return { name: parsed.name.trim(), phone: parsed.phone.trim() };
  } catch {
    return null;
  }
}

export function saveStoreLead(storeToken: string, lead: StoreLead) {
  localStorage.setItem(
    leadStorageKey(storeToken),
    JSON.stringify({ name: lead.name.trim(), phone: lead.phone.trim() }),
  );
}

export function formatPrice(price: number | null | undefined) {
  if (price == null || Number.isNaN(Number(price))) return "Consultar";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(price));
}
