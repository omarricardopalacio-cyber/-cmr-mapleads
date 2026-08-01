// @ts-nocheck
/**
 * Ejecución de respuesta IA (usada tras debounce / espera de flujo).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { stripLeakedToolMarkup } from "@/lib/message-text";
import { registerFailedAiRequest, sendSupportMessage } from "@/lib/retry-manager.server";
import { loadCustomerMemory, extractAndSaveMemory } from "@/lib/ai/customer-memory.server";
import {
  attachAiReplyRunner,
  scheduleDebouncedAiReply,
  processDueAiReplies,
  releaseAiReplyPendingForContact,
  cancelAiReplyPendingForThread,
} from "@/lib/ai-reply-pending.server";

export {
  scheduleDebouncedAiReply,
  processDueAiReplies,
  releaseAiReplyPendingForContact,
  cancelAiReplyPendingForThread,
};

const HISTORY_WINDOW = 30;
const MAX_MSG_CHARS = 2000;

function normalizeForReplyDedup(text: string) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function loadThreadHistory(orgId: string, threadId: string, userText: string) {
  const { data: prior } = await supabaseAdmin
    .from("messages")
    .select("direction, text, sent_at")
    .eq("thread_id", threadId)
    .not("text", "is", null)
    .order("sent_at", { ascending: false })
    .limit(HISTORY_WINDOW);

  const priorMsgs = ((prior ?? []) as any[])
    .filter((m: any) => typeof m.text === "string" && m.text.trim().length > 0)
    .reverse()
    .map((m: any) => ({
      role: (m.direction === "out" ? "assistant" : "user") as "assistant" | "user",
      content: String(m.text).trim().slice(0, MAX_MSG_CHARS),
    }));

  const lastPrior = priorMsgs[priorMsgs.length - 1];
  return lastPrior && lastPrior.role === "user" && lastPrior.content === userText.trim()
    ? priorMsgs
    : [...priorMsgs, { role: "user" as const, content: userText }];
}

async function hasRecentQueuedReply(
  orgId: string,
  sessionId: string,
  chatId: string,
  text: string,
  windowMs = 120_000,
) {
  if (!orgId || !sessionId || !chatId || !text?.trim()) return false;
  const since = new Date(Date.now() - windowMs).toISOString();
  const normalizedText = normalizeForReplyDedup(text);

  const { data } = await supabaseAdmin
    .from("engine_commands")
    .select("id, type, payload, status, scheduled_for, created_at")
    .eq("org_id", orgId)
    .eq("session_id", sessionId)
    .in("type", ["SEND_MESSAGE", "send_message"])
    .in("status", ["pending", "delivered"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(40);

  return (data ?? []).some((cmd: any) => {
    const payload = (cmd.payload as Record<string, unknown> | null) ?? {};
    const payloadText = normalizeForReplyDedup(String(payload.text ?? ""));
    const payloadChat = String(payload.chatId ?? "").trim();
    return payloadChat === String(chatId).trim() && payloadText === normalizedText;
  });
}

export async function hasExistingAiReplyCommand(
  orgId: string,
  sessionId: string,
  dedupeKey?: string,
): Promise<boolean> {
  if (!orgId || !sessionId || !dedupeKey) return false;

  const { data, error } = await supabaseAdmin
    .from("engine_commands")
    .select("id")
    .eq("org_id", orgId)
    .eq("session_id", sessionId)
    .contains("payload", { dedupeKey })
    .in("status", ["pending", "delivered", "acked"])
    .limit(1);

  if (error) {
    console.warn("[ai-reply] failed to query existing AI reply command", {
      orgId,
      sessionId,
      dedupeKey,
      error,
    });
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

export async function executeAiReply(params: {
  orgId: string;
  sessionId: string;
  chatId: string;
  contactId: string;
  threadId: string;
  text: string;
  delayAfterAutoReplies?: number;
  autoRepliesWereSent?: boolean;
  aiReplyDedupeKey?: string;
}) {
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
  } = params;

  const { data: thread } = await supabaseAdmin
    .from("threads")
    .select("ai_enabled, assigned_to_user_id")
    .eq("id", threadId)
    .maybeSingle();

  if ((thread as unknown as { ai_enabled?: boolean })?.ai_enabled === false) {
    console.info("[ai-reply] skip: IA desactivada en el hilo", { threadId });
    return;
  }

  const scheduleAt =
    delayAfterAutoReplies > 0
      ? new Date(Date.now() + (delayAfterAutoReplies + 2) * 1000).toISOString()
      : null;

  let { data: cfg } = await supabaseAdmin
    .from("ai_configs")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();

  if (!cfg) {
    try {
      const { cloneTemplateAiConfigToOrg } = await import("@/lib/org-helpers");
      await cloneTemplateAiConfigToOrg(orgId);
      const { data: newCfg } = await supabaseAdmin
        .from("ai_configs")
        .select("*")
        .eq("org_id", orgId)
        .maybeSingle();
      cfg = newCfg;
    } catch (cloneErr: any) {
      console.error("[ai-reply] Failed to clone AI config on-the-fly:", cloneErr.message);
    }
  }

  if (!cfg || !cfg.enabled) return;

  try {
    const { data: thFocus } = await supabaseAdmin
      .from("threads")
      .select("focused_product_id, focused_updated_at")
      .eq("id", threadId)
      .eq("org_id", orgId)
      .maybeSingle();
    const focusedAt = (thFocus as any)?.focused_updated_at
      ? new Date(String((thFocus as any).focused_updated_at)).getTime()
      : 0;
    const focusAgeMs = focusedAt ? Date.now() - focusedAt : Number.POSITIVE_INFINITY;
    if ((thFocus as any)?.focused_product_id && focusAgeMs >= 0 && focusAgeMs < 90_000) {
      const { count: inboundCount } = await supabaseAdmin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", threadId)
        .eq("direction", "in");
      if ((inboundCount ?? 0) <= 1) {
        console.info("[ai-reply] defer: producto recién presentado; espera consulta del cliente", {
          threadId,
          focusAgeMs,
          inboundCount,
        });
        return;
      }
    }
  } catch (deferErr) {
    console.warn("[ai-reply] defer check failed:", (deferErr as Error)?.message);
  }

  if (cfg.respond_to === "new") {
    const { count } = await supabaseAdmin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", threadId)
      .eq("direction", "out");
    if ((count ?? 0) > 0) return;
  }

  const history = await loadThreadHistory(orgId, threadId, text);

  let historyWithContext = history;
  if (autoRepliesWereSent) {
    const systemNote = {
      role: "system" as const,
      content:
        "Acaban de enviarse mensajes automáticos al cliente. Continúa de forma natural, sin presentarte de nuevo y sin repetir lo ya dicho. Responde breve y haz máximo una pregunta.",
    };
    historyWithContext = [...history, systemNote];
  }

  let runAiAgent: any = null;
  let cfgFast: Record<string, unknown> | null = null;
  let provider = "lovable";

  try {
    const importedAi = await import("@/lib/ai.server");
    runAiAgent = importedAi.runAiAgent;
    cfgFast = { ...(cfg as Record<string, unknown>) };
    provider = (cfgFast.selected_provider as string) || (cfgFast.provider as string) || "lovable";
    if (provider === "lovable" && (!cfgFast.model || String(cfgFast.model).startsWith("gpt-"))) {
      cfgFast.model = "google/gemini-3-flash-preview";
    }

    console.info("[ai-reply] starting", {
      orgId,
      threadId,
      chatId,
      provider,
      model: cfgFast.model,
      respond_to: cfgFast.respond_to,
      hasVertexSecret: !!cfgFast.vertex_service_account_json,
      historyLength: historyWithContext.length,
    });

    const firstAttempt = await runAiAgent({
      orgId,
      threadId,
      contactId,
      sessionId,
      chatId,
      messages: historyWithContext,
      cfg: cfgFast,
    });

    let actions = firstAttempt.actions ?? [];
    let finalReply = stripLeakedToolMarkup(firstAttempt.reply?.trim() || "");

    const activatedFlow =
      actions?.includes("activate_flow") || actions?.includes("present_product");

    if (!activatedFlow) {
      if (!finalReply) {
        const sentImage =
          actions?.includes("send_product_image") || actions?.includes("send_product_video");
        if (sentImage) {
          finalReply = "¿Cuál te gusta más? Cuéntame y avanzamos con tu pedido.";
        } else {
          console.info("[ai-reply] sin texto útil; no se encola SEND_MESSAGE", {
            orgId,
            threadId,
            chatId,
            actions,
          });
          return;
        }
      }

      if (/activate_flow|present_product|<\/?function/i.test(finalReply)) {
        console.warn("[ai-reply] reply todavía contiene markup de tools; se omite envío", {
          orgId,
          threadId,
          preview: finalReply.slice(0, 120),
        });
        return;
      }

      console.info("[ai-reply] finalReply", {
        orgId,
        threadId,
        chatId,
        sessionId,
        finalReply,
        actions,
        replyLength: finalReply.length,
      });

      let skipQueue = false;
      if (aiReplyDedupeKey) {
        const duplicateReply = await hasExistingAiReplyCommand(orgId, sessionId, aiReplyDedupeKey);
        if (duplicateReply) {
          console.log("[ai-reply] skip duplicate queued reply by dedupeKey", {
            threadId,
            chatId,
            aiReplyDedupeKey,
          });
          skipQueue = true;
        }
      }

      if (!skipQueue) {
        const dupSameText = await hasRecentQueuedReply(orgId, sessionId, chatId, finalReply, 90_000);
        if (dupSameText) {
          console.log("[ai-reply] skip duplicate same text queued recently", { threadId, chatId });
          skipQueue = true;
        }
      }

      if (!skipQueue) {
        await supabaseAdmin.from("engine_commands").insert({
          org_id: orgId,
          session_id: sessionId,
          type: "SEND_MESSAGE",
          payload: { chatId, text: finalReply, dedupeKey: aiReplyDedupeKey },
          status: "pending",
          scheduled_for: scheduleAt,
        });
      }
    } else {
      console.info("[ai-reply] paquete activado por la IA; se omite respuesta de texto", {
        orgId,
        threadId,
        chatId,
        actions,
      });
      try {
        await supabaseAdmin
          .from("threads")
          .update({ ai_enabled: true } as unknown as Record<string, never>)
          .eq("id", threadId)
          .eq("org_id", orgId);
        console.info("[ai-reply] IA forzada ON tras activate_flow", { threadId, orgId });
      } catch (reOnErr) {
        console.warn(
          "[ai-reply] no se pudo forzar IA ON tras flujo:",
          (reOnErr as Error)?.message,
        );
      }
    }

    if (process.env.DISABLE_AI_MEMORY !== "true" && contactId) {
      try {
        const currentMemory = await loadCustomerMemory(orgId, contactId);
        await extractAndSaveMemory({
          orgId,
          contactId,
          userText: text,
          assistantReply: finalReply,
          actions,
          currentMemory,
          cfg: cfgFast,
        });
      } catch (memErr) {
        console.warn("[ai-reply] extractAndSaveMemory failed (ignorado)", {
          message: memErr instanceof Error ? memErr.message : String(memErr),
          orgId,
          threadId,
          contactId,
        });
      }
    }
  } catch (err) {
    let errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : "";
    console.warn("[ai-reply] first attempt failed", {
      message: errMsg,
      orgId,
      threadId,
      chatId,
      provider,
      model: cfgFast?.model,
      selected_provider: cfg?.selected_provider,
    });

    console.error("[ai-reply] error - DETALLES COMPLETOS:", {
      message: errMsg,
      stack: errStack?.slice(0, 500),
      orgId,
      threadId,
      chatId,
      provider: cfg?.provider,
      model: cfg?.model,
      selected_provider: cfg?.selected_provider,
      hasVertexKey: !!cfg?.vertex_service_account_json,
    });

    const requestId = await registerFailedAiRequest(
      orgId,
      threadId,
      chatId,
      sessionId,
      text,
      errMsg,
      0,
      3,
      {
        messageHistory: historyWithContext,
        cfgProvider: cfg?.selected_provider || cfg?.provider,
        cfgModel: cfg?.model,
      },
    );

    if (requestId && sessionId) {
      await sendSupportMessage(orgId, sessionId, chatId, requestId, threadId);
    }

    if (process.env.ENABLE_AI_HANDOFF_ON_ERROR === "true") {
      try {
        await supabaseAdmin
          .from("threads")
          .update({ ai_enabled: false } as unknown as Record<string, never>)
          .eq("id", threadId)
          .eq("org_id", orgId);
        console.info(
          "[ai-reply] IA no pudo responder: conversación transferida a humano (ai_enabled=false)",
          { orgId, threadId, chatId },
        );
      } catch (handoffErr) {
        console.warn(
          "[ai-reply] no se pudo transferir a humano (ai_enabled puede no existir):",
          (handoffErr as Error)?.message,
        );
      }
    } else {
      console.warn("[ai-reply] error de IA; hilo sigue con IA activa (sin handoff automático)", {
        orgId,
        threadId,
        chatId,
      });
    }
  }
}

attachAiReplyRunner(executeAiReply);
