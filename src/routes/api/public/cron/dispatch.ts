import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { convertUrlToBase64 } from "@/lib/media";

const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const dyn = () => supabaseAdmin as unknown as { from: (t: string) => any };

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
  const CRON_SECRET = process.env.CRON_SECRET;
  if (!CRON_SECRET) return json(500, { error: "server not configured: CRON_SECRET missing" });
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
    if (b.media_url) {
      try {
        const media = await convertUrlToBase64(b.media_url);
        mediaBase64 = media.base64;
        mediaMimeType = b.mime_type || media.mimeType;
      } catch (err: any) {
        await supabaseAdmin
          .from("broadcasts")
          .update({ status: "failed", error_log: err.message ?? "media download failed", finished_at: now })
          .eq("id", b.id);
        continue;
      }
    }

    let sentInBatch = 0;
    let failedInBatch = 0;

    for (const r of pending) {
      let payload: Record<string, unknown> = { chatId: r.wa_id, text: b.message_text };
      let type = "send_message";
      if (mediaBase64) {
        type = "send_media";
        payload = { chatId: r.wa_id, base64: mediaBase64, mimeType: mediaMimeType };
      }

      const { data: cmd, error } = await supabaseAdmin
        .from("engine_commands")
        .insert({
          org_id: b.org_id,
          session_id: b.session_id,
          type,
          payload,
          status: "pending",
        })
        .select("id")
        .single();
      if (error) {
        await supabaseAdmin
          .from("broadcast_recipients")
          .update({ status: "failed", error: error.message })
          .eq("id", r.id);
        failedInBatch++;
        continue;
      }
      await supabaseAdmin
        .from("broadcast_recipients")
        .update({ status: "sending", command_id: cmd!.id })
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
  await processFlowSteps(now);

  return json(200, { ok: true, ...result });
}

async function processFlowSteps(now: string) {
  const { data: runs } = await (supabaseAdmin as unknown as { from: (t: string) => { select: (cols: string) => { eq: (c: string, v: string) => { lte: (c: string, v: string) => { limit: (n: number) => Promise<{ data: any[] | null }> } } } } })
    .from("flow_runs")
    .select("id, org_id, flow_id, contact_id, current_step_id, status, last_interaction_at, next_execution_at, flow_steps(*)")
    .eq("status", "active")
    .lte("next_execution_at", now)
    .limit(100);

  for (const run of runs ?? []) {
    try {
      const step = (run as any).flow_steps;
      if (!step) {
        await dyn().from("flow_runs").update({ status: "completed" }).eq("id", run.id);
        continue;
      }

      const { data: flow } = await dyn().from("flows").select("id, org_id").eq("id", run.flow_id).single();
      if (!flow) {
        await dyn().from("flow_runs").update({ status: "completed" }).eq("id", run.id);
        continue;
      }

      const sd = step.step_data ?? {};
      const nextNow = new Date().toISOString();

      if (step.step_type === "send_message") {
        const { data: contact } = await supabaseAdmin.from("contacts").select("wa_id").eq("id", run.contact_id).single();
        const waId = contact?.wa_id;
        if (waId) {
          await supabaseAdmin.from("engine_commands").insert({
            org_id: flow.org_id,
            session_id: sd.session_id,
            type: "send_message",
            payload: { chatId: waId, text: sd.text },
            status: "pending",
          });
        }
        await advanceFlowStep(run.id, step.id, flow.id);
      } else if (step.step_type === "send_media") {
        const { data: contact } = await supabaseAdmin.from("contacts").select("wa_id").eq("id", run.contact_id).single();
        const waId = contact?.wa_id;
        if (waId && sd.media_url) {
          const media = await convertUrlToBase64(sd.media_url);
          await supabaseAdmin.from("engine_commands").insert({
            org_id: flow.org_id,
            session_id: sd.session_id,
            type: "send_media",
            payload: { chatId: waId, base64: media.base64, mimeType: sd.mime_type || media.mimeType },
            status: "pending",
          });
        }
        await advanceFlowStep(run.id, step.id, flow.id);
      } else if (step.step_type === "wait") {
        const amount = sd.amount ?? 1;
        const unit = sd.unit ?? "hours";
        const ms = unit === "days" ? amount * 24 * 60 * 60 * 1000 : amount * 60 * 60 * 1000;
        const nextAt = new Date(Date.now() + ms).toISOString();
        await dyn()
          .from("flow_runs")
          .update({ status: "wait_node", next_execution_at: nextAt, updated_at: nextNow })
          .eq("id", run.id);
      } else if (step.step_type === "add_tag") {
        if (sd.tag_id) {
          await (supabaseAdmin as unknown as { from: (t: string) => { upsert: (d: unknown, opts?: unknown) => Promise<unknown> } })
            .from("contact_tags")
            .upsert({ contact_id: run.contact_id, tag_id: sd.tag_id, org_id: flow.org_id }, { onConflict: "contact_id,tag_id" });
        }
        await advanceFlowStep(run.id, step.id, flow.id);
      } else if (step.step_type === "remove_tag") {
        if (sd.tag_id) {
          await (supabaseAdmin as unknown as { from: (t: string) => { delete: () => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<unknown> } } } })
            .from("contact_tags")
            .delete()
            .eq("contact_id", run.contact_id)
            .eq("tag_id", sd.tag_id);
        }
        await advanceFlowStep(run.id, step.id, flow.id);
      } else if (step.step_type === "toggle_ai") {
        if (sd.ai_enabled !== undefined) {
          const { data: thread } = await supabaseAdmin
            .from("threads")
            .select("id")
            .eq("contact_id", run.contact_id)
            .eq("session_id", sd.session_id)
            .maybeSingle();
          if (thread) {
            await supabaseAdmin.from("threads").update({ ai_enabled: sd.ai_enabled }).eq("id", thread.id);
          }
        }
        await advanceFlowStep(run.id, step.id, flow.id);
      } else if (step.step_type === "condition_reply") {
        const waitStarted = run.next_execution_at ?? run.created_at;
        const replied = run.last_interaction_at && new Date(run.last_interaction_at) > new Date(waitStarted);
        const branch = replied ? "yes" : "no";
        await advanceFlowStep(run.id, step.id, flow.id, branch);
      } else {
        await advanceFlowStep(run.id, step.id, flow.id);
      }
    } catch (err: any) {
      console.error("Flow run error", run.id, err.message);
    }
  }
}

async function advanceFlowStep(runId: string, currentStepId: string, flowId: string, forcedBranch?: string) {
  const { data: nextStep } = await dyn()
    .from("flow_steps")
    .select("id")
    .eq("flow_id", flowId)
    .eq("parent_step_id", currentStepId)
    .eq("branch", forcedBranch ?? "yes")
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextStep) {
    await dyn()
      .from("flow_runs")
      .update({ current_step_id: nextStep.id, status: "active", next_execution_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", runId);
  } else {
    const { data: seqNext } = await dyn()
      .from("flow_steps")
      .select("id, step_order")
      .eq("flow_id", flowId)
      .gt("step_order", (await dyn().from("flow_steps").select("step_order").eq("id", currentStepId).single()).data?.step_order ?? 0)
      .is("parent_step_id", null)
      .order("step_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (seqNext) {
      await dyn()
        .from("flow_runs")
        .update({ current_step_id: seqNext.id, status: "active", next_execution_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", runId);
    } else {
      await dyn()
        .from("flow_runs")
        .update({ status: "completed", current_step_id: null, updated_at: new Date().toISOString() })
        .eq("id", runId);
    }
  }
}
