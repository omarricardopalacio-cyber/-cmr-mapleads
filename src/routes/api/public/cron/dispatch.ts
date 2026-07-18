// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { convertUrlToBase64 } from "@/lib/media";
import { processDueRuns } from "@/lib/flow-runner.server";

// For broadcast media: try base64 first, fall back to URL-only if too large
async function resolveMediaForBroadcast(mediaUrl: string): Promise<{ base64?: string; mimeType?: string; mediaUrl?: string }> {
  try {
    const { base64, mimeType } = await convertUrlToBase64(mediaUrl);
    return { base64, mimeType };
  } catch (err: any) {
    console.warn("[broadcast] base64 conversion failed, falling back to URL:", err.message);
    // Fall back to sending the URL directly (engine will handle download)
    return { mediaUrl };
  }
}

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


  const result = { scheduled: 0, broadcast: 0 };
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
      const { data: remaining } = await supabaseAdmin
        .from("broadcast_recipients")
        .select("id", { count: "exact", head: true })
        .eq("broadcast_id", b.id)
        .eq("status", "pending");
      if (!remaining || remaining.length === 0) {
        await supabaseAdmin
          .from("broadcasts")
          .update({ status: "done", finished_at: now })
          .eq("id", b.id);
      }
      continue;
    }

    let mediaBase64: string | null = null;
    let mediaMimeType: string | null = null;
    let mediaFallbackUrl: string | null = null;
    if (b.media_url) {
      const resolved = await resolveMediaForBroadcast(b.media_url);
      if (resolved.base64) {
        mediaBase64 = resolved.base64;
        mediaMimeType = b.mime_type || resolved.mimeType || null;
      } else if (resolved.mediaUrl) {
        mediaFallbackUrl = resolved.mediaUrl;
        mediaMimeType = b.mime_type || null;
      }
    }

    let sentInBatch = 0;
    let failedInBatch = 0;

    for (const r of pending) {
      let payload: Record<string, unknown>;
      let type: string;

      if (mediaBase64) {
        // Send media with caption
        type = "send_media";
        payload = {
          chatId: r.wa_id,
          media: mediaBase64,
          mimeType: mediaMimeType,
          caption: b.message_text || undefined,
        };
      } else if (mediaFallbackUrl) {
        // Send media via URL with caption
        type = "send_media";
        payload = {
          chatId: r.wa_id,
          mediaUrl: mediaFallbackUrl,
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
          session_id: b.session_id,
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

  return json(200, { ok: true, ...result });
}
