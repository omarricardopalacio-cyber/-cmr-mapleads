import { createFileRoute } from "@tanstack/react-router";
import {
  clientIp,
  listStoreProducts,
  rateLimit,
  resolveStoreByToken,
} from "@/lib/store.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Store-Token",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export const Route = createFileRoute("/api/public/store/products")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const ip = clientIp(request);
        if (!rateLimit(`store-products:${ip}`, 120, 60_000)) {
          return json(429, { error: "Too many requests" });
        }
        const url = new URL(request.url);
        const token = request.headers.get("x-store-token") || url.searchParams.get("token");
        if (!token) return json(401, { error: "Missing store token" });
        const store = await resolveStoreByToken(token);
        if (!store) return json(401, { error: "Invalid store token" });

        try {
          const products = await listStoreProducts(store.org_id, {
            q: url.searchParams.get("q") || undefined,
            id: url.searchParams.get("id") || undefined,
            limit: Number(url.searchParams.get("limit") || 48),
          });
          return json(200, { products });
        } catch (err: any) {
          return json(500, { error: err?.message || "Failed to list products" });
        }
      },
    },
  },
});
