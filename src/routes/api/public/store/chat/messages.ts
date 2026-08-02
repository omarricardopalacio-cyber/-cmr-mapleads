import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runChannelAiReply } from "@/lib/channel-ai-reply.server";
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

async function authStoreAndVisitor(request: Request) {
  const storeToken = request.headers.get("x-store-token");
  const visitorToken = request.headers.get("x-visitor-token");
  if (!storeToken || !visitorToken) return { error: "Missing tokens", status: 401 as const };
  const store = await resolveStoreByToken(storeToken);
  if (!store) return { error: "Invalid store token", status: 401 as const };
  const { data: webSession } = await (supabaseAdmin as any)
    .from("web_sessions")
    .select("id, org_id, visitor_token")
    .eq("visitor_token", visitorToken)
    .eq("org_id", store.org_id)
    .maybeSingle();
  if (!webSession) return { error: "Invalid visitor", status: 401 as const };
  const { data: thread } = await (supabaseAdmin as any)
    .from("threads")
    .select("id, contact_id, ai_enabled, channel, focused_product_id, unread_count")
    .eq("web_session_id", webSession.id)
    .eq("org_id", store.org_id)
    .eq("channel", "web")
    .maybeSingle();
  if (!thread) return { error: "Thread not found", status: 404 as const };
  return { store, webSession, thread };
}

export const Route = createFileRoute("/api/public/store/chat/messages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const ip = clientIp(request);
        if (!rateLimit(`store-msgs-get:${ip}`, 180, 60_000)) {
          return json(429, { error: "Too many requests" });
        }
        const auth = await authStoreAndVisitor(request);
        if ("error" in auth && auth.error) return json(auth.status, { error: auth.error });
        const { thread } = auth as any;

        const url = new URL(request.url);
        const since = url.searchParams.get("since");
        let q = (supabaseAdmin as any)
          .from("messages")
          .select("id, direction, text, media, sent_at, created_at")
          .eq("thread_id", thread.id)
          .order("sent_at", { ascending: true })
          .limit(200);
        if (since) q = q.gt("sent_at", since);

        const { data, error } = await q;
        if (error) return json(500, { error: error.message });
        return json(200, {
          messages: data ?? [],
          threadId: thread.id,
          aiEnabled: thread.ai_enabled !== false,
        });
      },
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!rateLimit(`store-msgs-post:${ip}`, 40, 60_000)) {
          return json(429, { error: "Too many requests" });
        }
        const auth = await authStoreAndVisitor(request);
        if ("error" in auth && auth.error) return json(auth.status, { error: auth.error });
        const { store, thread } = auth as any;

        let body: { text?: string } = {};
        try {
          body = await request.json();
        } catch {
          return json(400, { error: "Invalid JSON" });
        }
        const text = String(body.text || "").trim().slice(0, 4000);
        if (!text) return json(400, { error: "Empty message" });

        const now = new Date().toISOString();
        const { error: inErr } = await supabaseAdmin.from("messages").insert({
          org_id: store.org_id,
          thread_id: thread.id,
          direction: "in",
          text,
          wa_message_id: `web-in-${Date.now()}`,
          sent_at: now,
          raw: { channel: "web" },
        });
        if (inErr) return json(500, { error: inErr.message });

        try {
          const { appendContactAskedQuestion } = await import("@/lib/contact-inquiry.server");
          await appendContactAskedQuestion({
            orgId: store.org_id,
            contactId: thread.contact_id,
            text,
          });
        } catch {
          /* no bloquear chat */
        }

        await supabaseAdmin
          .from("threads")
          .update({
            last_message_at: now,
            unread_count: (thread.unread_count || 0) + 1,
          } as any)
          .eq("id", thread.id);

        // Flujos por keyword (mismo criterio que WhatsApp ingest)
        let keywordStarted = false;
        try {
          const { tryKeywordFlowsForText } = await import("@/lib/flow-trigger.server");
          const focusedProductId = thread.focused_product_id
            ? String(thread.focused_product_id)
            : null;
          const kw = await tryKeywordFlowsForText({
            orgId: store.org_id,
            contactId: thread.contact_id,
            text,
            focusedProductId,
          });
          keywordStarted = kw.started;
          if (keywordStarted) {
            console.info("[store/chat/messages] keyword flow activado", {
              threadId: thread.id,
              flowId: kw.flowId,
            });
          }
        } catch (kwErr: any) {
          console.warn("[store/chat/messages] keyword flow:", kwErr?.message || kwErr);
        }

        let aiResult = { reply: "", actions: [] as string[], skipped: true };
        // Si un flujo tomó el turno, no competir con la IA en el mismo mensaje.
        if (!keywordStarted) {
          try {
            aiResult = await runChannelAiReply({
              orgId: store.org_id,
              threadId: thread.id,
              contactId: thread.contact_id,
              text,
              channel: "web",
            });
          } catch (err: any) {
            console.error("[store/chat/messages] AI failed", err);
            if (process.env.DISABLE_AI_HANDOFF_ON_ERROR !== "true") {
              await supabaseAdmin
                .from("threads")
                .update({ ai_enabled: false } as any)
                .eq("id", thread.id);
            }
            await supabaseAdmin.from("messages").insert({
              org_id: store.org_id,
              thread_id: thread.id,
              direction: "out",
              text: "Un momento, te conecto con un asesor 😊",
              wa_message_id: `web-fallback-${Date.now()}`,
              sent_at: new Date().toISOString(),
            });
          }
        }

        return json(200, {
          ok: true,
          reply: aiResult.reply || null,
          skipped: keywordStarted ? true : aiResult.skipped,
          actions: aiResult.actions,
          flowStarted: keywordStarted,
        });
      },
    },
  },
});
