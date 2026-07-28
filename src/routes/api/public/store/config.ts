import { createFileRoute } from "@tanstack/react-router";
import {
  clientIp,
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

export const Route = createFileRoute("/api/public/store/config")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const ip = clientIp(request);
        if (!rateLimit(`store-config:${ip}`, 60, 60_000)) {
          return json(429, { error: "Too many requests" });
        }
        const token = request.headers.get("x-store-token") || new URL(request.url).searchParams.get("token");
        if (!token) return json(401, { error: "Missing store token" });
        const store = await resolveStoreByToken(token);
        if (!store) return json(401, { error: "Invalid store token" });
        return json(200, {
          brandName: store.brand_name,
          logoUrl: store.logo_url,
          primaryColor: store.primary_color,
          accentColor: store.accent_color || "#FF2D95",
          socialTitle: store.social_title || store.brand_name,
          socialDescription: store.social_description,
          socialImageUrl: store.social_image_url || store.logo_url,
          orgId: store.org_id,
        });
      },
    },
  },
});
