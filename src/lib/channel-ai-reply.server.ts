import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  loadCustomerMemory,
  extractAndSaveMemory,
} from "@/lib/ai/customer-memory.server";

export type ChannelAiReplyParams = {
  orgId: string;
  threadId: string;
  contactId: string;
  text: string;
  /** WhatsApp only */
  sessionId?: string | null;
  chatId?: string | null;
  /** 'whatsapp' | 'web' */
  channel: "whatsapp" | "web";
  autoRepliesWereSent?: boolean;
  aiReplyDedupeKey?: string;
  delayAfterAutoReplies?: number;
  /** Ignora respond_to=new (p. ej. apertura de producto en tienda web) */
  forceReply?: boolean;
};

export type ChannelAiReplyResult = {
  reply: string;
  actions: string[];
  skipped: boolean;
  reason?: string;
};

const HISTORY_WINDOW = 30;
const MAX_MSG_CHARS = 2000;

async function loadThreadHistory(threadId: string, userText: string) {
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

/**
 * Respuesta IA compartida para WhatsApp y canal web.
 * - whatsapp: encola engine_commands
 * - web: inserta messages.out (Realtime al cliente)
 */
export async function runChannelAiReply(
  params: ChannelAiReplyParams,
): Promise<ChannelAiReplyResult> {
  const {
    orgId,
    threadId,
    contactId,
    text,
    sessionId,
    chatId,
    channel,
    autoRepliesWereSent = false,
    aiReplyDedupeKey,
    delayAfterAutoReplies = 0,
    forceReply = false,
  } = params;

  const { data: thread } = await supabaseAdmin
    .from("threads")
    .select("ai_enabled, focused_product_snapshot")
    .eq("id", threadId)
    .maybeSingle();

  if ((thread as any)?.ai_enabled === false) {
    return { reply: "", actions: [], skipped: true, reason: "ai_disabled" };
  }

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
      console.error("[channel-ai] clone AI config failed", cloneErr?.message);
    }
  }

  if (!cfg || !(cfg as any).enabled) {
    return { reply: "", actions: [], skipped: true, reason: "ai_config_disabled" };
  }

  // En tienda web el chat debe continuar; "solo nuevos" aplica a WhatsApp.
  if (!forceReply && channel !== "web" && (cfg as any).respond_to === "new") {
    const { count } = await supabaseAdmin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", threadId)
      .eq("direction", "out");
    if ((count ?? 0) > 0) {
      return { reply: "", actions: [], skipped: true, reason: "respond_to_new" };
    }
  }

  const history = await loadThreadHistory(threadId, text);
  let historyWithContext = history;

  const snap = (thread as any)?.focused_product_snapshot as Record<string, unknown> | null;
  if (snap && (snap.name || snap.id)) {
    const obs = snap.ai_observation ? String(snap.ai_observation).trim() : "";
    historyWithContext = [
      {
        role: "system" as const,
        content: [
          "PRODUCTO EN FOCO (el cliente lo abrió en la tienda web; vende ESTE producto salvo que pida otro):",
          `- Nombre: ${snap.name ?? ""}`,
          snap.price != null ? `- Precio: ${snap.price}` : null,
          snap.sku ? `- SKU: ${snap.sku}` : null,
          snap.category ? `- Categoría: ${snap.category}` : null,
          snap.description ? `- Descripción: ${String(snap.description).slice(0, 800)}` : null,
          obs
            ? `\n=== OBSERVACIÓN ESPECIAL DEL VENDEDOR (OBLIGATORIO) ===\n${obs.slice(0, 1500)}`
            : null,
          "Usa precio y datos de este producto. Si el cliente cambia de producto, el foco se actualizará.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      ...historyWithContext,
    ];
  }

  if (autoRepliesWereSent) {
    historyWithContext = [
      ...historyWithContext,
      {
        role: "system" as const,
        content:
          "Acaban de enviarse mensajes automáticos al cliente. Continúa de forma natural, sin presentarte de nuevo y sin repetir lo ya dicho. Responde breve y haz máximo una pregunta.",
      },
    ];
  }

  const { runAiAgent } = await import("@/lib/ai.server");
  const cfgFast: Record<string, unknown> = { ...(cfg as Record<string, unknown>) };
  const provider =
    (cfgFast.selected_provider as string) || (cfgFast.provider as string) || "lovable";
  if (provider === "lovable" && (!cfgFast.model || String(cfgFast.model).startsWith("gpt-"))) {
    cfgFast.model = "google/gemini-3-flash-preview";
  }

  const result = await runAiAgent({
    orgId,
    threadId,
    contactId,
    sessionId: sessionId || undefined,
    chatId: chatId || undefined,
    messages: historyWithContext as any,
    cfg: cfgFast,
  });

  let actions = result.actions ?? [];
  let finalReply = result.reply?.trim() || "";
  const activatedFlow = actions.includes("activate_flow");

  if (!activatedFlow) {
    if (!finalReply) {
      const sentImage =
        actions.includes("send_product_image") || actions.includes("send_product_video");
      finalReply = sentImage
        ? "¿Cuál te gusta más? Cuéntame y avanzamos con tu pedido."
        : "Un momento por favor… ¿me confirmas qué producto te interesa?";
    }

    if (channel === "web") {
      await supabaseAdmin.from("messages").insert({
        org_id: orgId,
        thread_id: threadId,
        direction: "out",
        text: finalReply,
        wa_message_id: `web-ai-${Date.now()}`,
        sent_at: new Date().toISOString(),
        raw: { channel: "web", actions },
      });
      await supabaseAdmin
        .from("threads")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", threadId)
        .eq("org_id", orgId);
    } else if (sessionId && chatId) {
      const scheduleAt =
        delayAfterAutoReplies > 0
          ? new Date(Date.now() + (delayAfterAutoReplies + 2) * 1000).toISOString()
          : null;
      await supabaseAdmin.from("engine_commands").insert({
        org_id: orgId,
        session_id: sessionId,
        type: "SEND_MESSAGE",
        payload: { chatId, text: finalReply, dedupeKey: aiReplyDedupeKey },
        status: "pending",
        scheduled_for: scheduleAt,
      });
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
      console.warn("[channel-ai] extractAndSaveMemory failed", memErr);
    }
  }

  return { reply: finalReply, actions, skipped: false };
}
