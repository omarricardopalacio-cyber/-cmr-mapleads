import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  clientIp,
  hashToken,
  newVisitorToken,
  rateLimit,
  resolveStoreByToken,
} from "@/lib/store.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Store-Token",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export const Route = createFileRoute("/api/public/store/chat/session")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!rateLimit(`store-session:${ip}`, 30, 60_000)) {
          return json(429, { error: "Too many requests" });
        }
        const token = request.headers.get("x-store-token");
        if (!token) return json(401, { error: "Missing store token" });
        const store = await resolveStoreByToken(token);
        if (!store) return json(401, { error: "Invalid store token" });

        let body: { visitorToken?: string; displayName?: string; productId?: string; productName?: string } =
          {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }

        try {
          let visitorToken = String(body.visitorToken || "").trim();
          let webSession: any = null;

          if (visitorToken) {
            const { data } = await (supabaseAdmin as any)
              .from("web_sessions")
              .select("id, visitor_token, org_id")
              .eq("visitor_token", visitorToken)
              .eq("org_id", store.org_id)
              .maybeSingle();
            webSession = data;
          }

          if (!webSession) {
            visitorToken = newVisitorToken();
            const { data, error } = await (supabaseAdmin as any)
              .from("web_sessions")
              .insert({
                org_id: store.org_id,
                visitor_token: visitorToken,
                display_name: body.displayName?.trim() || null,
                last_seen_at: new Date().toISOString(),
              })
              .select("id, visitor_token, org_id")
              .single();
            if (error || !data) throw new Error(error?.message || "web_session insert failed");
            webSession = data;
          } else {
            await (supabaseAdmin as any)
              .from("web_sessions")
              .update({ last_seen_at: new Date().toISOString() })
              .eq("id", webSession.id);
          }

          const waId = `web:${webSession.visitor_token}`;
          let contactId: string;
          const { data: existingContact } = await (supabaseAdmin as any)
            .from("contacts")
            .select("id")
            .eq("org_id", store.org_id)
            .eq("wa_id", waId)
            .maybeSingle();

          if (existingContact?.id) {
            contactId = existingContact.id;
          } else {
            const { data: c, error: cErr } = await (supabaseAdmin as any)
              .from("contacts")
              .insert({
                org_id: store.org_id,
                wa_id: waId,
                web_visitor_id: hashToken(webSession.visitor_token),
                display_name: body.displayName?.trim() || "Visitante web",
                phone: null,
              })
              .select("id")
              .single();
            if (cErr || !c) throw new Error(cErr?.message || "contact insert failed");
            contactId = c.id;
          }

          let threadId: string;
          const { data: existingThread } = await (supabaseAdmin as any)
            .from("threads")
            .select("id")
            .eq("org_id", store.org_id)
            .eq("web_session_id", webSession.id)
            .eq("channel", "web")
            .maybeSingle();

          if (existingThread?.id) {
            threadId = existingThread.id;
          } else {
            const { data: t, error: tErr } = await (supabaseAdmin as any)
              .from("threads")
              .insert({
                org_id: store.org_id,
                contact_id: contactId,
                web_session_id: webSession.id,
                channel: "web",
                session_id: null,
                ai_enabled: true,
                last_message_at: new Date().toISOString(),
                unread_count: 0,
              })
              .select("id")
              .single();
            if (tErr || !t) throw new Error(tErr?.message || "thread insert failed");
            threadId = t.id;
          }

          // Contexto de producto: mensaje sistema interno no visible? Mejor nota en raw vía primer user hint
          const productHint =
            body.productName || body.productId
              ? `Me interesa el producto: ${body.productName || body.productId}`
              : null;

          return json(200, {
            visitorToken: webSession.visitor_token,
            threadId,
            contactId,
            productHint,
            brandName: store.brand_name,
            primaryColor: store.primary_color,
          });
        } catch (err: any) {
          console.error("[store/chat/session]", err);
          return json(500, { error: err?.message || "session failed" });
        }
      },
    },
  },
});
