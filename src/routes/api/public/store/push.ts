import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  clearStoreVisitorUnread,
  getVapidPublicKey,
} from "@/lib/store-web-push.server";
import { clientIp, rateLimit, resolveStoreByToken } from "@/lib/store.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Store-Token, X-Visitor-Token",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export const Route = createFileRoute("/api/public/store/push")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const ip = clientIp(request);
        if (!rateLimit(`store-push-get:${ip}`, 60, 60_000)) {
          return json(429, { error: "Too many requests" });
        }
        const url = new URL(request.url);
        const action = url.searchParams.get("action") || "vapid";
        if (action === "vapid") {
          const publicKey = getVapidPublicKey();
          return json(200, {
            enabled: !!publicKey,
            publicKey,
          });
        }
        return json(400, { error: "Unknown action" });
      },
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!rateLimit(`store-push-post:${ip}`, 40, 60_000)) {
          return json(429, { error: "Too many requests" });
        }

        const storeToken = request.headers.get("x-store-token");
        const visitorToken = request.headers.get("x-visitor-token");
        if (!storeToken || !visitorToken) {
          return json(401, { error: "Missing tokens" });
        }
        const store = await resolveStoreByToken(storeToken);
        if (!store) return json(401, { error: "Invalid store token" });

        let body: {
          action?: string;
          endpoint?: string;
          keys?: { p256dh?: string; auth?: string };
        } = {};
        try {
          body = await request.json();
        } catch {
          return json(400, { error: "Invalid JSON" });
        }

        const action = String(body.action || "subscribe");

        if (action === "read") {
          try {
            await clearStoreVisitorUnread({
              orgId: store.org_id,
              visitorToken,
            });
          } catch (err: any) {
            // Columna unread_out puede faltar si no corrieron migración
            if (!String(err?.message || "").includes("unread_out")) {
              console.warn("[store/push] clear unread", err);
            }
          }
          return json(200, { ok: true });
        }

        if (action === "unsubscribe") {
          const endpoint = String(body.endpoint || "").trim();
          if (!endpoint) return json(400, { error: "Missing endpoint" });
          await (supabaseAdmin as any)
            .from("web_push_subscriptions")
            .delete()
            .eq("org_id", store.org_id)
            .eq("visitor_token", visitorToken)
            .eq("endpoint", endpoint);
          return json(200, { ok: true });
        }

        // subscribe
        if (!getVapidPublicKey()) {
          return json(503, { error: "Push no configurado (VAPID)" });
        }
        const endpoint = String(body.endpoint || "").trim();
        const p256dh = String(body.keys?.p256dh || "").trim();
        const auth = String(body.keys?.auth || "").trim();
        if (!endpoint || !p256dh || !auth) {
          return json(400, { error: "Subscription incompleta" });
        }

        const { error } = await (supabaseAdmin as any)
          .from("web_push_subscriptions")
          .upsert(
            {
              org_id: store.org_id,
              visitor_token: visitorToken,
              endpoint,
              p256dh,
              auth,
              user_agent: request.headers.get("user-agent")?.slice(0, 240) || null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "endpoint" },
          );

        if (error) {
          if (error.message?.includes("web_push_subscriptions") || error.code === "42P01") {
            return json(503, {
              error:
                "Falta tabla web_push_subscriptions. Ejecuta la migración 20260727220000_web_push_subscriptions.sql",
            });
          }
          return json(500, { error: error.message });
        }

        return json(200, { ok: true });
      },
    },
  },
});
