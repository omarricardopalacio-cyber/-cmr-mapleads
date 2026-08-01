/**
 * Debounce + espera de flujo para respuestas de IA.
 *
 * - Varios mensajes rápidos del cliente → una sola respuesta.
 * - Si hay flow_run en active/running → no responde; reprograma.
 * - Al terminar el flujo (o quedar en wait_node) se libera la cola.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const dyn = () => supabaseAdmin as unknown as { from: (t: string) => any };

export type AiReplyRunner = (params: {
  orgId: string;
  sessionId: string;
  chatId: string;
  contactId: string;
  threadId: string;
  text: string;
  delayAfterAutoReplies?: number;
  autoRepliesWereSent?: boolean;
  aiReplyDedupeKey?: string;
}) => Promise<void>;

let aiReplyRunner: AiReplyRunner | null = null;

export function attachAiReplyRunner(fn: AiReplyRunner) {
  aiReplyRunner = fn;
}

function debounceMs() {
  const n = Number(process.env.AI_REPLY_DEBOUNCE_MS || 5000);
  return Number.isFinite(n) && n >= 1000 ? n : 5000;
}

function flowWaitMs() {
  const n = Number(process.env.AI_REPLY_FLOW_WAIT_MS || 5000);
  return Number.isFinite(n) && n >= 1000 ? n : 5000;
}

function isoIn(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

/** Agrupa mensajes inbound rápidos/partidos en un solo texto para la IA. */
async function collectBurstInboundText(
  threadId: string,
  windowMs = debounceMs() + 3000,
): Promise<string | null> {
  if (!threadId) return null;
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data: msgs, error } = await dyn()
    .from("messages")
    .select("text, direction, sent_at")
    .eq("thread_id", threadId)
    .gte("sent_at", since)
    .order("sent_at", { ascending: true });
  if (error || !msgs?.length) return null;

  const parts: string[] = [];
  for (const m of msgs) {
    if (m.direction === "out") {
      parts.length = 0;
      continue;
    }
    const t = String(m.text || "").trim();
    if (t) parts.push(t);
  }
  if (!parts.length) return null;
  return parts.join(" ");
}

export async function contactHasExecutingFlow(contactId: string): Promise<boolean> {
  if (!contactId) return false;
  const { data: runs, error } = await dyn()
    .from("flow_runs")
    .select("id, status, next_execution_at")
    .eq("contact_id", contactId)
    .in("status", ["active", "running", "wait_node"]);

  if (error) {
    console.warn("[ai-reply-pending] flow check failed:", error.message);
    return false;
  }
  if (!runs || runs.length === 0) return false;

  const now = Date.now();
  return runs.some((run: any) => {
    if (run.status === "active" || run.status === "running") {
      return true;
    }
    if (run.status === "wait_node" && run.next_execution_at) {
      const nextTime = new Date(run.next_execution_at).getTime();
      const diffMs = nextTime - now;
      if (diffMs < 5 * 60 * 1000) {
        return true;
      }
    }
    return false;
  });
}

export async function hasPendingEngineCommandsForChat(
  sessionId: string,
  chatId: string,
): Promise<boolean> {
  if (!sessionId || !chatId) return false;
  try {
    const { data: commands, error } = await dyn()
      .from("engine_commands")
      .select("payload")
      .eq("session_id", sessionId)
      .eq("status", "pending");

    if (error || !commands) return false;

    const target = chatId.trim().toLowerCase();
    for (const cmd of commands) {
      const p = (cmd.payload as any) || {};
      const c1 = String(p.chatId || p.chat_id || "").trim().toLowerCase();
      if (c1 === target || c1.replace("@c.us", "") === target.replace("@c.us", "")) {
        return true;
      }
    }
  } catch (err) {
    console.warn("[ai-reply-pending] failed to check pending commands:", err);
  }
  return false;
}

export async function scheduleDebouncedAiReply(params: {
  orgId: string;
  sessionId: string;
  chatId: string;
  contactId: string;
  threadId: string;
  text: string;
  delayAfterAutoReplies?: number;
  autoRepliesWereSent?: boolean;
  aiReplyDedupeKey?: string;
  waitForFlow?: boolean;
}): Promise<void> {
  const {
    orgId,
    sessionId,
    chatId,
    contactId,
    threadId,
    text,
    delayAfterAutoReplies = 0,
    autoRepliesWereSent = false,
    aiReplyDedupeKey,
    waitForFlow = true,
  } = params;

  const extraMs = Math.max(0, Number(delayAfterAutoReplies) || 0) * 1000;
  const respondAfter = isoIn(debounceMs() + extraMs);
  const now = new Date().toISOString();

  // En Serverless (Netlify), si no hay flujos en ejecución, ni comandos pendientes, ni retardo de auto-respuestas,
  // ejecutamos la IA de forma inmediata y síncrona para garantizar la respuesta instantánea en 1-2s.
  let isBusy = false;
  if (waitForFlow !== false && contactId) {
    isBusy = await contactHasExecutingFlow(contactId);
  }
  const hasPendingCmds = await hasPendingEngineCommandsForChat(sessionId, chatId);
  const shouldExecuteImmediately = !isBusy && !hasPendingCmds && extraMs === 0;

  if (shouldExecuteImmediately) {
    const runner = await ensureRunner();
    if (runner) {
      console.info("[ai-reply-pending] ejecución inmediata (sin flujos ni retardo en serverless)", {
        threadId,
        contactId,
        sessionId,
        chatId,
      });
      await runner({
        orgId,
        sessionId,
        chatId,
        contactId,
        threadId,
        text,
        delayAfterAutoReplies,
        autoRepliesWereSent,
        aiReplyDedupeKey,
      });
      return;
    }
    console.warn("[ai-reply-pending] runner inmediato no disponible; cayendo a programación pendient", {
      threadId,
      contactId,
      sessionId,
      chatId,
    });
  }

  const { data: existing } = await dyn()
    .from("ai_reply_pending")
    .select("id, generation, auto_replies_were_sent")
    .eq("thread_id", threadId)
    .is("processed_at", null)
    .is("cancelled_at", null)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await dyn()
      .from("ai_reply_pending")
      .update({
        session_id: sessionId,
        contact_id: contactId,
        chat_id: chatId,
        latest_text: text,
        dedupe_key: aiReplyDedupeKey || null,
        delay_after_auto_replies: delayAfterAutoReplies,
        auto_replies_were_sent: autoRepliesWereSent || !!existing.auto_replies_were_sent,
        wait_for_flow: waitForFlow,
        generation: (existing.generation || 1) + 1,
        respond_after: respondAfter,
        updated_at: now,
        processing_at: null,
      })
      .eq("id", existing.id);
    if (error) {
      console.error("[ai-reply-pending] update failed:", error.message, {
        threadId,
        existingId: existing.id,
      });
      return;
    }
    console.info("[ai-reply-pending] reprogramado (debounce)", {
      threadId,
      respondAfter,
      generation: (existing.generation || 1) + 1,
      existingId: existing.id,
    });
  } else {
    const { error } = await dyn().from("ai_reply_pending").insert({
      org_id: orgId,
      session_id: sessionId,
      thread_id: threadId,
      contact_id: contactId,
      chat_id: chatId,
      latest_text: text,
      dedupe_key: aiReplyDedupeKey || null,
      delay_after_auto_replies: delayAfterAutoReplies,
      auto_replies_were_sent: autoRepliesWereSent,
      wait_for_flow: waitForFlow,
      generation: 1,
      respond_after: respondAfter,
      created_at: now,
      updated_at: now,
    });
    if (error) {
      // Carrera: otro proceso insertó; reintentar update
      if (String(error.message || "").includes("duplicate") || error.code === "23505") {
        await scheduleDebouncedAiReply(params);
        return;
      }
      console.error("[ai-reply-pending] insert failed:", error.message);
      return;
    }
    console.info("[ai-reply-pending] programado", { threadId, respondAfter });
  }

  // Despertar tras el debounce (best-effort en serverless)
  const wakeIn = debounceMs() + extraMs + 250;
  const capturedThread = threadId;
  setTimeout(() => {
    void processDueAiReplies({ threadId: capturedThread, limit: 5 }).catch((err) => {
      console.warn("[ai-reply-pending] wake failed:", (err as Error)?.message);
    });
  }, wakeIn);
}

/** Tras completar o pausar un flujo: adelanta la respuesta pendiente del contacto. */
export async function releaseAiReplyPendingForContact(contactId: string): Promise<void> {
  if (!contactId) return;
  const respondAfter = isoIn(debounceMs());
  const now = new Date().toISOString();
  const { data: rows, error } = await dyn()
    .from("ai_reply_pending")
    .update({
      respond_after: respondAfter,
      updated_at: now,
      processing_at: null,
    })
    .eq("contact_id", contactId)
    .is("processed_at", null)
    .is("cancelled_at", null)
    .select("id, thread_id");

  if (error) {
    console.warn("[ai-reply-pending] release failed:", error.message);
    return;
  }
  if (!rows?.length) return;

  console.info("[ai-reply-pending] liberado tras flujo", {
    contactId,
    count: rows.length,
    respondAfter,
  });

  setTimeout(() => {
    for (const row of rows) {
      void processDueAiReplies({ threadId: row.thread_id, limit: 5 }).catch(() => {});
    }
  }, debounceMs() + 250);
}

export async function cancelAiReplyPendingForThread(threadId: string, reason?: string) {
  if (!threadId) return;
  const now = new Date().toISOString();
  await dyn()
    .from("ai_reply_pending")
    .update({ cancelled_at: now, updated_at: now, processing_at: null })
    .eq("thread_id", threadId)
    .is("processed_at", null)
    .is("cancelled_at", null);
  if (reason) {
    console.info("[ai-reply-pending] cancelado", { threadId, reason });
  }
}

async function ensureRunner(): Promise<AiReplyRunner | null> {
  if (aiReplyRunner) return aiReplyRunner;
  try {
    // Carga el módulo que registra el runner (evita ciclo en import estático).
    await import("@/lib/ai-reply.server");
  } catch (err) {
    console.warn(
      "[ai-reply-pending] no se pudo cargar ai-reply.server:",
      (err as Error)?.message,
    );
  }
  return aiReplyRunner;
}

export async function processDueAiReplies(opts?: {
  threadId?: string;
  limit?: number;
}): Promise<{ processed: number; deferred: number; skipped: number }> {
  const limit = opts?.limit ?? 40;
  const now = new Date().toISOString();
  let processed = 0;
  let deferred = 0;
  let skipped = 0;

  let q = dyn()
    .from("ai_reply_pending")
    .select(
      "id, org_id, session_id, thread_id, contact_id, chat_id, latest_text, dedupe_key, delay_after_auto_replies, auto_replies_were_sent, wait_for_flow, generation, respond_after",
    )
    .lte("respond_after", now)
    .is("processed_at", null)
    .is("cancelled_at", null)
    .is("processing_at", null)
    .order("respond_after", { ascending: true })
    .limit(limit);

  if (opts?.threadId) q = q.eq("thread_id", opts.threadId);

  console.info("[ai-reply-pending] buscando respuestas IA pendientes", {
    threadId: opts?.threadId,
    limit,
    now,
  });
  const { data: due, error } = await q;
  if (error) {
    console.error("[ai-reply-pending] fetch due failed:", error.message, {
      threadId: opts?.threadId,
    });
    return { processed, deferred, skipped };
  }
  if (!due?.length) {
    console.info("[ai-reply-pending] no hay respuestas IA pendientes debidas", {
      threadId: opts?.threadId,
    });
    return { processed, deferred, skipped };
  }

  const runner = await ensureRunner();
  if (!runner) {
    console.warn("[ai-reply-pending] sin runner; se reintentará luego", {
      threadId: opts?.threadId,
      pendingCount: due.length,
    });
    return { processed, deferred, skipped: due.length };
  }

  for (const row of due) {
    try {
      // Claim optimista
      const claimAt = new Date().toISOString();
      const { data: claimed, error: claimErr } = await dyn()
        .from("ai_reply_pending")
        .update({ processing_at: claimAt })
        .eq("id", row.id)
        .eq("generation", row.generation)
        .is("processed_at", null)
        .is("cancelled_at", null)
        .is("processing_at", null)
        .select("id")
        .maybeSingle();

      if (claimErr || !claimed) {
        console.info("[ai-reply-pending] claim falló; otro proceso se adelantó", {
          threadId: row.thread_id,
          pendingId: row.id,
          generation: row.generation,
        });
        skipped++;
        continue;
      }

      // ¿Llegó otro mensaje mientras reclamábamos?
      const { data: fresh } = await dyn()
        .from("ai_reply_pending")
        .select("generation, respond_after")
        .eq("id", row.id)
        .maybeSingle();
      if (!fresh || fresh.generation !== row.generation) {
        await dyn()
          .from("ai_reply_pending")
          .update({ processing_at: null })
          .eq("id", row.id);
        skipped++;
        continue;
      }
      if (fresh.respond_after && new Date(fresh.respond_after).getTime() > Date.now()) {
        await dyn()
          .from("ai_reply_pending")
          .update({ processing_at: null })
          .eq("id", row.id);
        console.info("[ai-reply-pending] respuesta IA reprogramada por responder después", {
          threadId: row.thread_id,
          pendingId: row.id,
          respondAfter: fresh.respond_after,
        });
        deferred++;
        continue;
      }

      if (row.wait_for_flow !== false) {
        const busy = await contactHasExecutingFlow(row.contact_id);
        const hasPendingCommands = await hasPendingEngineCommandsForChat(row.session_id, row.chat_id);
        if (busy || hasPendingCommands) {
          const nextAt = isoIn(flowWaitMs());
          await dyn()
            .from("ai_reply_pending")
            .update({
              respond_after: nextAt,
              processing_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          console.info("[ai-reply-pending] flujo o comandos aún ejecutando/pendientes; reprograma", {
            threadId: row.thread_id,
            busy,
            hasPendingCommands,
            nextAt,
          });
          deferred++;
          continue;
        }
      }

      // Historial completo: agrupar ráfaga de mensajes partidos del cliente
      let text = String(row.latest_text || "").trim();
      try {
        const burst = await collectBurstInboundText(row.thread_id);
        if (burst) text = burst;
        else {
          const { data: lastIn } = await dyn()
            .from("messages")
            .select("text")
            .eq("thread_id", row.thread_id)
            .eq("direction", "in")
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (lastIn?.text && String(lastIn.text).trim()) {
            text = String(lastIn.text).trim();
          }
        }
      } catch (_) {
        /* keep latest_text */
      }

      await runner({
        orgId: row.org_id,
        sessionId: row.session_id,
        chatId: row.chat_id,
        contactId: row.contact_id,
        threadId: row.thread_id,
        text,
        delayAfterAutoReplies: 0,
        autoRepliesWereSent: !!row.auto_replies_were_sent,
        aiReplyDedupeKey: row.dedupe_key || undefined,
      });

      await dyn()
        .from("ai_reply_pending")
        .update({
          processed_at: new Date().toISOString(),
          processing_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("generation", row.generation);

      processed++;
      console.info("[ai-reply-pending] respondido", {
        threadId: row.thread_id,
        generation: row.generation,
      });
    } catch (err) {
      console.error(
        "[ai-reply-pending] process error:",
        (err as Error)?.message || err,
        { id: row.id },
      );
      await dyn()
        .from("ai_reply_pending")
        .update({
          processing_at: null,
          respond_after: isoIn(flowWaitMs()),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      skipped++;
    }
  }

  return { processed, deferred, skipped };
}
