/** Cliente storefront (catálogo + chat web). */

export type StoreConfigPublic = {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
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
  slug?: string | null;
  sku?: string | null;
  badge?: string | null;
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
  return res.json();
}

export async function fetchStoreProducts(
  storeToken: string,
  opts?: { q?: string; id?: string },
): Promise<StoreProduct[]> {
  const u = new URL("/api/public/store/products", window.location.origin);
  u.searchParams.set("token", storeToken);
  if (opts?.q) u.searchParams.set("q", opts.q);
  if (opts?.id) u.searchParams.set("id", opts.id);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Products error");
  const data = await res.json();
  return data.products ?? [];
}

export async function openChatSession(
  storeToken: string,
  opts?: { visitorToken?: string; productId?: string; productName?: string },
) {
  const res = await fetch("/api/public/store/chat/session", {
    method: "POST",
    headers: headers(storeToken),
    body: JSON.stringify({
      visitorToken: opts?.visitorToken,
      productId: opts?.productId,
      productName: opts?.productName,
    }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Session error");
  return res.json() as Promise<{
    visitorToken: string;
    threadId: string;
    productHint: string | null;
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

export function formatPrice(price: number | null | undefined) {
  if (price == null || Number.isNaN(Number(price))) return "Consultar";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(price));
}
