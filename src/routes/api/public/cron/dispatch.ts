// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processDueRuns } from "@/lib/flow-runner.server";
import { processDueAiReplies } from "@/lib/ai-reply.server";

const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

/**
 * Dispatcher: corre cada minuto.
 * - Despacha scheduled_messages pendientes con send_at <= now()
 * - Despacha broadcasts en estado 'running' respetando rate_per_minute
 */
export const Route = createFileRoute("/api/public/cron/dispatch")({
  server: {
    handlers: {
      POST: handler,
      GET: handler,
    },
  },
});

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function handler({ request }: { request: Request }) {
  const CRON_SECRET = process.env.CRON_SECRET || process.env.SUPABASE_ANON_KEY;
  if (!CRON_SECRET) return json(500, { error: "server not configured: CRON_SECRET/SUPABASE_ANON_KEY missing" });
  const raw = request.headers.get("apikey") ?? request.headers.get("authorization") ?? "";
  const apikey = raw.replace(/^Bearer\s+/i, "").trim();
  if (!apikey || !timingSafeStringEqual(apikey, CRON_SECRET)) {
    return json(401, { error: "invalid apikey" });
  }


  const result = { scheduled: 0, broadcast: 0, aiReplyPending: { processed: 0, deferred: 0, skipped: 0 } };
  const now = new Date().toISOString();

  // 1) Scheduled messages due
  const { data: due } = await supabaseAdmin
    .from("scheduled_messages")
    .select("id, org_id, session_id, wa_id, text")
    .eq("status", "pending")
    .lte("send_at", now)
    .limit(100);

  for (const m of due ?? []) {
    const { data: cmd, error } = await supabaseAdmin
      .from("engine_commands")
      .insert({
        org_id: m.org_id,
        session_id: m.session_id,
        type: "send_message",
        payload: { chatId: m.wa_id, text: m.text },
        status: "pending",
      })
      .select("id")
      .single();
    if (error) {
      await supabaseAdmin
        .from("scheduled_messages")
        .update({ status: "failed", error: error.message })
        .eq("id", m.id);
      continue;
    }
    await supabaseAdmin
      .from("scheduled_messages")
      .update({ status: "sent", sent_at: now, command_id: cmd!.id })
      .eq("id", m.id);
    result.scheduled++;
  }

  // 2) Broadcasts running
  const { data: broadcasts } = await supabaseAdmin
    .from("broadcasts")
    .select("id, org_id, session_id, message_text, media_url, mime_type, rate_per_minute, total_count, sent_count, failed_count, status, scheduled_at, error_log")
    .in("status", ["running", "scheduled"])
    .limit(50);

  for (const b of broadcasts ?? []) {
    if (b.status === "scheduled") {
      if (!b.scheduled_at || new Date(b.scheduled_at) > new Date()) continue;
      await supabaseAdmin
        .from("broadcasts")
        .update({ status: "running", started_at: now })
        .eq("id", b.id);
    }

    const batch = Math.max(1, Math.min(b.rate_per_minute ?? 15, 60));
    const { data: pending } = await supabaseAdmin
      .from("broadcast_recipients")
      .select("id, wa_id")
      .eq("broadcast_id", b.id)
      .eq("status", "pending")
      .limit(batch);

    // Helper: normalize wa_id to WhatsApp JID format (e.g. 573... → 573...@c.us)
    function normalizeWaIdForBroadcast(rawWaId: string): string {
      const stripped = rawWaId.split('@')[0].replace(/\D/g, '');
      return stripped ? `${stripped}@c.us` : rawWaId;
    }

    if (!pending?.length) {
      const { count: remainingCount } = await supabaseAdmin
        .from("broadcast_recipients")
        .select("id", { count: "exact", head: true })
        .eq("broadcast_id", b.id)
        .eq("status", "pending");
      if ((remainingCount ?? 0) === 0) {
        await supabaseAdmin
          .from("broadcasts")
          .update({ status: "done", finished_at: now })
          .eq("id", b.id);
      }
      continue;
    }

    // La extensión descarga la URL al ejecutar. Nunca copiar base64 en cada
    // destinatario: una sola campaña podía inflar engine_commands por cientos de MB.
    const mediaUrl = b.media_url || null;
    const mediaMimeType = b.mime_type || null;

    let sentInBatch = 0;
    let failedInBatch = 0;

    // Resolve active connected session for the organization
    const { data: activeSess } = await supabaseAdmin
      .from("wa_sessions")
      .select("id")
      .eq("org_id", b.org_id)
      .eq("status", "connected")
      .order("last_heartbeat_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const targetSessionId = activeSess?.id || b.session_id;

    for (const r of pending) {
      let payload: Record<string, unknown>;
      let type: string;

      if (mediaUrl) {
        // Send media via URL with caption
        type = "send_media";
        payload = {
          chatId: r.wa_id,
          mediaUrl,
          mimeType: mediaMimeType,
          caption: b.message_text || undefined,
        };
      } else {
        // Text-only message
        type = "send_message";
        payload = { chatId: r.wa_id, text: b.message_text };
      }

      const { data: cmd, error } = await supabaseAdmin
        .from("engine_commands")
        .insert({
          org_id: b.org_id,
          session_id: targetSessionId,
          type,
          payload: { ...payload, chatId: normalizeWaIdForBroadcast(r.wa_id) },
          status: "pending",
        })
        .select("id")
        .single();
      if (error) {
        await supabaseAdmin
          .from("broadcast_recipients")
          .update({ status: "failed", error: error.message, sent_at: now })
          .eq("id", r.id);
        failedInBatch++;
        continue;
      }
      await supabaseAdmin
        .from("broadcast_recipients")
        .update({ status: "sent", command_id: cmd!.id, sent_at: now })
        .eq("id", r.id);
      sentInBatch++;
      result.broadcast++;
    }

    const newSent = (b.sent_count ?? 0) + sentInBatch;
    const newFailed = (b.failed_count ?? 0) + failedInBatch;
    await supabaseAdmin
      .from("broadcasts")
      .update({ sent_count: newSent, failed_count: newFailed })
      .eq("id", b.id);
  }

  // 3) Flow steps
  await processDueRuns();

  // 3b) Reclamar delivered sin ACK (extensión cayó / Failed to fetch) → pending de nuevo
  try {
    const reclaimBefore = new Date(Date.now() - 90_000).toISOString();
    const { data: reclaimed, error: reclaimErr } = await supabaseAdmin
      .from("engine_commands")
      .update({ status: "pending", delivered_at: null } as any)
      .eq("status", "delivered")
      .is("acked_at", null)
      .lt("delivered_at", reclaimBefore)
      .select("id");
    if (reclaimErr) {
      console.warn("[dispatch] reclaim delivered:", reclaimErr.message);
    } else if (reclaimed?.length) {
      console.warn("[dispatch] reclaimed stuck delivered commands", { count: reclaimed.length });
    }
  } catch (err) {
    console.warn("[dispatch] reclaim delivered:", (err as Error)?.message);
  }

  // 3c) Expirar pending antiguos (>10 min)
  try {
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: staleCmds, error: staleErr } = await supabaseAdmin
      .from("engine_commands")
      .update({
        status: "failed",
        ack: { error: "expired_stale_pending", at: now },
        acked_at: now,
      } as any)
      .eq("status", "pending")
      .lt("created_at", staleBefore)
      .select("id");
    if (staleErr) {
      console.warn("[dispatch] expire stale commands:", staleErr.message);
    } else if (staleCmds?.length) {
      console.warn("[dispatch] expired stale engine_commands", { count: staleCmds.length });
    }
  } catch (err) {
    console.warn("[dispatch] expire stale commands:", (err as Error)?.message);
  }

  // 4) Respuestas IA pendientes (debounce + post-flujo)
  try {
    const aiPending = await processDueAiReplies({ limit: 40 });
    result.aiReplyPending = aiPending;
  } catch (err) {
    console.warn("[dispatch] processDueAiReplies failed:", (err as Error)?.message);
  }

  return json(200, { ok: true, ...result });
}
