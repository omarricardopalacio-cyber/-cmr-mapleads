import { createFileRoute } from "@tanstack/react-router";
import {
  clientIp,
  listStoreCategories,
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
          if (url.searchParams.get("meta") === "1") {
            const categories = await listStoreCategories(store.org_id);
            return json(200, { categories });
          }

          const result = await listStoreProducts(store.org_id, {
            q: url.searchParams.get("q") || undefined,
            id: url.searchParams.get("id") || undefined,
            category: url.searchParams.get("category") || undefined,
            limit: Number(url.searchParams.get("limit") || 24),
            offset: Number(url.searchParams.get("offset") || 0),
          });
          return json(200, result);
        } catch (err: any) {
          return json(500, { error: err?.message || "Failed to list products" });
        }
      },
    },
  },
});
