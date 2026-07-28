import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  clientIp,
  hashToken,
  newVisitorToken,
  rateLimit,
  resolveStoreByToken,
} from "@/lib/store.server";
import { focusStoreProduct } from "@/lib/store-product-chat.server";

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

function normalizeWhatsApp(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  // Colombia: 10 dígitos locales → 57…
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

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

        let body: {
          visitorToken?: string;
          displayName?: string;
          phone?: string;
          productId?: string;
          productName?: string;
          /** Si false, solo crea sesión sin enfocar producto (p. ej. aún en formulario) */
          startProduct?: boolean;
        } = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }

        try {
          let visitorToken = String(body.visitorToken || "").trim();
          let webSession: any = null;
          const displayName = String(body.displayName || "").trim().slice(0, 80);
          const phoneNorm = body.phone ? normalizeWhatsApp(body.phone) : null;

          if (visitorToken) {
            const { data } = await (supabaseAdmin as any)
              .from("web_sessions")
              .select("id, visitor_token, org_id, display_name")
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
                display_name: displayName || null,
                last_seen_at: new Date().toISOString(),
              })
              .select("id, visitor_token, org_id, display_name")
              .single();
            if (error || !data) throw new Error(error?.message || "web_session insert failed");
            webSession = data;
          } else {
            const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
            if (displayName) patch.display_name = displayName;
            await (supabaseAdmin as any)
              .from("web_sessions")
              .update(patch)
              .eq("id", webSession.id);
          }

          const waId = `web:${webSession.visitor_token}`;
          let contactId: string;
          const { data: existingContact } = await (supabaseAdmin as any)
            .from("contacts")
            .select("id, display_name, phone")
            .eq("org_id", store.org_id)
            .eq("wa_id", waId)
            .maybeSingle();

          if (existingContact?.id) {
            contactId = existingContact.id;
            const contactPatch: Record<string, unknown> = {
              updated_at: new Date().toISOString(),
            };
            if (displayName) contactPatch.display_name = displayName;
            if (phoneNorm) contactPatch.phone = phoneNorm;
            if (Object.keys(contactPatch).length > 1) {
              await (supabaseAdmin as any)
                .from("contacts")
                .update(contactPatch)
                .eq("id", contactId);
            }
          } else {
            const { data: c, error: cErr } = await (supabaseAdmin as any)
              .from("contacts")
              .insert({
                org_id: store.org_id,
                wa_id: waId,
                web_visitor_id: hashToken(webSession.visitor_token),
                display_name: displayName || "Visitante web",
                phone: phoneNorm,
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

          let productFocus: Awaited<ReturnType<typeof focusStoreProduct>> = null;
          const productId = String(body.productId || "").trim();
          const shouldStartProduct = body.startProduct !== false && !!productId;
          if (shouldStartProduct) {
            try {
              productFocus = await focusStoreProduct({
                orgId: store.org_id,
                threadId,
                contactId,
                productId,
              });
            } catch (focusErr) {
              console.error("[store/chat/session] product focus failed", focusErr);
            }
          }

          return json(200, {
            visitorToken: webSession.visitor_token,
            threadId,
            contactId,
            productHint: null,
            productFocus,
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
