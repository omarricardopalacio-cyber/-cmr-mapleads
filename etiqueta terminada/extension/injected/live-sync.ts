// Respaldo de chat.new_message.
// WA-JS solo emite si msg.isNewMsg; en chats @lid el store agrega el mensaje
// con isNewMsg=false y el CRM se queda mudo aunque WPP esté OK.

import { getWPP } from "./wpp-bootstrap";
import { shouldIngestLiveMessage } from "../shared/live-message";

const CATCHUP_MS = 20 * 60_000;
const POLL_MS = 2_000;

export function startLiveMessageSync(onMessage: (msg: any) => Promise<void> | void): () => void {
  const catchupSinceMs = Date.now() - CATCHUP_MS;
  let stopped = false;
  const seen = new Set<string>();
  const queue: any[] = [];
  let pumping = false;

  const messageId = (msg: any): string =>
    String(msg?.id?._serialized || (typeof msg?.id === "string" ? msg.id : "") || "");

  const enqueue = (msg: any, source: "add" | "poll") => {
    if (stopped || !msg) return;
    const id = messageId(msg);
    if (!id || seen.has(id)) return;
    const remote = String(msg?.id?.remote?._serialized || msg?.from?._serialized || "");
    if (remote.endsWith("@g.us") || remote.includes("status@broadcast")) return;
    if (
      !shouldIngestLiveMessage({
        messageId: id,
        type: msg?.type,
        timestampSec: Number(msg?.t || msg?.timestamp || 0),
        nowMs: Date.now(),
        catchupSinceMs,
        allowMissingTimestamp: source === "add" && msg?.isNewMsg === true,
      })
    ) {
      return;
    }
    seen.add(id);
    if (seen.size > 2000) {
      const drop = seen.values().next().value;
      if (drop) seen.delete(drop);
    }
    queue.push(msg);
    if (queue.length > 40) queue.splice(0, queue.length - 40);
    void pump();
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length && !stopped) {
        const msg = queue.shift();
        try {
          await onMessage(msg);
        } catch (err) {
          console.warn("[LiveSync] no se pudo emitir", err);
        }
      }
    } finally {
      pumping = false;
    }
  };

  const attachStore = () => {
    const WPP = getWPP();
    const store = WPP?.whatsapp?.MsgStore || WPP?.whatsapp?.MsgCollection;
    if (!store || typeof store.on !== "function") return false;
    const onAdd = (msg: any) => enqueue(msg, "add");
    const onChange = (msg: any) => enqueue(msg, "add");
    try {
      store.on("add", onAdd);
      store.on("change", onChange);
    } catch (err) {
      console.warn("[LiveSync] MsgStore.on falló", err);
      return false;
    }
    console.log("[LiveSync] MsgStore enganchado (sin filtro isNewMsg)");
    return () => {
      try {
        store.off?.("add", onAdd);
        store.off?.("change", onChange);
      } catch {
        /* ignore */
      }
    };
  };

  let detach = attachStore();
  const retryAttach = window.setInterval(() => {
    if (detach) {
      window.clearInterval(retryAttach);
      return;
    }
    detach = attachStore();
  }, 3000);

  const poll = async () => {
    if (stopped) return;
    const WPP = getWPP();
    if (!WPP?.chat?.list) return;
    let chats: any[] = [];
    try {
      chats = await WPP.chat.list();
    } catch {
      return;
    }
    const cutoff = Math.floor(catchupSinceMs / 1000);
    const recent = (Array.isArray(chats) ? chats : [])
      .filter((chat) => Number(chat?.t || chat?.lastMessage?.t || 0) >= cutoff)
      .slice(0, 12);
    for (const chat of recent) {
      const last =
        chat?.lastMessage ||
        chat?.msgs?.getModelsArray?.()?.slice(-1)?.[0] ||
        chat?.msgs?.models?.slice(-1)?.[0];
      if (last) {
        enqueue(last, "poll");
        continue;
      }
      const chatId = chat?.id?._serialized || (typeof chat?.id === "string" ? chat.id : "");
      if (!chatId || typeof WPP.chat?.getMessages !== "function") continue;
      try {
        const msgs = await WPP.chat.getMessages(chatId, { count: 2 });
        const fresh = Array.isArray(msgs) ? msgs[msgs.length - 1] : null;
        if (fresh) enqueue(fresh, "poll");
      } catch {
        /* el siguiente tick lo reintenta */
      }
    }
  };

  const timer = window.setInterval(() => void poll(), POLL_MS);
  void poll();

  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.clearInterval(retryAttach);
    if (typeof detach === "function") detach();
  };
}
