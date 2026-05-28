import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

async function handler({ request }: { request: Request }) {
  // Permite anon key como apikey o Authorization Bearer
  const apikey = request.headers.get("apikey") ?? request.headers.get("authorization");
  if (!apikey) return json(401, { error: "missing apikey" });

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
    .select("id, org_id, session_id, message_text, rate_per_minute, total_count, sent_count, status, scheduled_at")
    .in("status", ["running", "scheduled"])
    .limit(50);

  for (const b of broadcasts ?? []) {
    // Promote scheduled → running si llegó la hora
    if (b.status === "scheduled") {
      if (!b.scheduled_at || new Date(b.scheduled_at) > new Date()) continue;
      await supabaseAdmin
        .from("broadcasts")
        .update({ status: "running", started_at: now })
        .eq("id", b.id);
    }

    const batch = Math.max(1, Math.min(b.rate_per_minute, 60));
    const { data: pending } = await supabaseAdmin
      .from("broadcast_recipients")
      .select("id, wa_id")
      .eq("broadcast_id", b.id)
      .eq("status", "pending")
      .limit(batch);

    if (!pending?.length) {
      await supabaseAdmin
        .from("broadcasts")
        .update({ status: "done", finished_at: now })
        .eq("id", b.id);
      continue;
    }

    for (const r of pending) {
      const { data: cmd, error } = await supabaseAdmin
        .from("engine_commands")
        .insert({
          org_id: b.org_id,
          session_id: b.session_id,
          type: "send_message",
          payload: { chatId: r.wa_id, text: b.message_text },
          status: "pending",
        })
        .select("id")
        .single();
      if (error) {
        await supabaseAdmin
          .from("broadcast_recipients")
          .update({ status: "failed", error: error.message })
          .eq("id", r.id);
        await supabaseAdmin
          .from("broadcasts")
          .update({ failed_count: (b.sent_count ?? 0) })
          .eq("id", b.id);
        continue;
      }
      await supabaseAdmin
        .from("broadcast_recipients")
        .update({ status: "sent", sent_at: now, command_id: cmd!.id })
        .eq("id", r.id);
      result.broadcast++;
    }

    await supabaseAdmin
      .from("broadcasts")
      .update({ sent_count: (b.sent_count ?? 0) + pending.length })
      .eq("id", b.id);
  }

  return json(200, { ok: true, ...result });
}
