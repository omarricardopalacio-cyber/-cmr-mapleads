// ============================================================
// MAPLE WA ENGINE — Chat Detector (Injected Script)
// Extrae lista de chats y datos del chat activo
// ============================================================

import { getWPP, patchWhatsAppCompat } from "./wpp-bootstrap";

export async function getActiveChat(): Promise<any> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  const chat = await WPP.chat.getActiveChat();
  return chat ? normalizeChat(chat) : null;
}

export async function getChatList(options: { limit?: number; slim?: boolean } = {}): Promise<any[]> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  const chats = await WPP.chat.list();
  const slim = options.slim !== false;
  let mapped = chats.map((c: any) => (slim ? normalizeChatSlim(c) : normalizeChat(c)));

  // Solo 1:1 (sin grupos)
  mapped = mapped.filter((c: any) => !c.isGroup && !String(c.chatId || "").includes("@g.us"));

  // Hasta ~1500 chats 1:1 (cuentas grandes ~1000+)
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 1500) : undefined;
  if (limit) mapped = mapped.slice(0, limit);

  return mapped;
}

export async function findChat(chatId: string): Promise<any> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  const chat = await WPP.chat.find(chatId);
  return chat ? normalizeChat(chat) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Acceso a módulos internos de WhatsApp Web (webpack require). */
function waRequire(moduleName: string): any {
  try {
    const req = (window as any).require || (globalThis as any).require;
    if (typeof req === "function") return req(moduleName);
  } catch {
    /* módulo ausente en esta build */
  }
  return null;
}

/** Lee msgs ya cargados en el chat sin pasar por getMessages (evita isBot). */
function getChatMsgModels(chat: any): any[] {
  if (!chat) return [];
  let models: any[] = [];
  try {
    if (typeof chat.msgs?.getModelsArray === "function") {
      models = chat.msgs.getModelsArray();
    } else if (Array.isArray(chat.msgs?.models)) {
      models = chat.msgs.models;
    } else if (typeof chat.msgs?.toArray === "function") {
      models = chat.msgs.toArray();
    }
  } catch {
    return [];
  }
  return [...models]
    .filter(Boolean)
    .sort((a, b) => Number(a?.t || 0) - Number(b?.t || 0));
}

function readMsgsFromChatModel(chat: any, count: number): any[] {
  return getChatMsgModels(chat).slice(-Math.max(1, count));
}

async function loadChatModel(WPP: any, chatId: string): Promise<any | null> {
  try {
    if (typeof WPP.chat.get === "function") {
      const c = await WPP.chat.get(chatId);
      if (c) return c;
    }
  } catch {
    /* continue */
  }
  try {
    return (await WPP.chat.find(chatId)) || null;
  } catch {
    return null;
  }
}

/** Clic en el aviso de WA: "Haz clic aquí para obtener mensajes anteriores..." */
function clickLoadOlderMessagesButton(): boolean {
  const needles = [
    "obtener mensajes anteriores",
    "mensajes anteriores de tu teléfono",
    "mensajes anteriores",
    "older messages from your phone",
    "click here to get older",
    "get older messages",
    "use whatsapp on your phone to see older",
  ];

  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>(
      '#main div[role="button"], #main button, #main span[role="button"], #main div[tabindex="0"]'
    )
  );

  for (const el of nodes) {
    const raw = (el.innerText || el.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!raw || raw.length > 220) continue;
    if (!needles.some((n) => raw.includes(n))) continue;
    try {
      el.click();
      console.log("[ChatDetector] Clic en botón de mensajes anteriores");
      return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Scroll arriba del panel de mensajes para forzar lazy-load local. */
async function scrollMsgPaneUp(rounds = 6): Promise<void> {
  const root = document.querySelector("#main");
  if (!root) return;
  const scrollers = Array.from(root.querySelectorAll("div")).filter((el) => {
    const h = el as HTMLElement;
    const style = window.getComputedStyle(h);
    const oy = style.overflowY;
    return (
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      h.scrollHeight > h.clientHeight + 80
    );
  }) as HTMLElement[];
  const scroller = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (!scroller) return;
  for (let i = 0; i < rounds; i++) {
    scroller.scrollTop = 0;
    await sleep(180);
  }
}

/**
 * Pide al teléfono el historial (mismo mecanismo que el botón de WA Web).
 * PDO type 3 = HISTORY_SYNC_ON_DEMAND (cuando endOfHistoryTransferType === 0).
 */
async function triggerHistorySyncOnDemand(WPP: any, chat: any): Promise<boolean> {
  if (!chat?.id) return false;
  try {
    const mod = waRequire("WAWebSendNonMessageDataRequest");
    const send =
      mod?.sendPeerDataOperationRequest ||
      (WPP as any).whatsapp?.SendNonMessageDataRequest?.sendPeerDataOperationRequest ||
      (WPP as any).whatsapp?.sendPeerDataOperationRequest;
    if (typeof send !== "function") return false;
    await send(3, { chatId: chat.id });
    console.log("[ChatDetector] History sync on-demand disparado");
    return true;
  } catch (err: any) {
    console.warn("[ChatDetector] sync on-demand:", err?.message || err);
    return false;
  }
}

/** Carga desde IndexedDB local hacia memoria (equivalente a scrollear hacia arriba). */
async function loadEarlierMsgsRounds(
  chat: any,
  targetCount: number,
  maxRounds = 25
): Promise<number> {
  const loadMod = waRequire("WAWebChatLoadMessages");
  const coll = waRequire("WAWebCollections");
  const loadFn =
    loadMod?.loadEarlierMsgs ||
    (typeof chat?.loadEarlierMsgs === "function" ? (...args: any[]) => chat.loadEarlierMsgs(...args) : null) ||
    coll?.ConversationMsgs?.loadEarlierMsgs ||
    (WPPFallbackLoadEarlier(chat));

  if (!loadFn) return getChatMsgModels(chat).length;

  for (let i = 0; i < maxRounds; i++) {
    const before = getChatMsgModels(chat).length;
    if (before >= targetCount) break;
    let loaded: any = null;
    try {
      loaded = await loadFn({ chat });
    } catch {
      try {
        loaded = await loadFn(chat);
      } catch {
        break;
      }
    }
    await sleep(220);
    const after = getChatMsgModels(chat).length;
    const got =
      (Array.isArray(loaded) && loaded.length > 0) || after > before;
    if (!got) break;
  }
  return getChatMsgModels(chat).length;
}

function WPPFallbackLoadEarlier(chat: any): ((arg: any) => Promise<any>) | null {
  try {
    const wpp = getWPP() as any;
    const fn =
      wpp?.whatsapp?.ConversationMsgs?.loadEarlierMsgs ||
      wpp?.whatsapp?.ChatLoadMessages?.loadEarlierMsgs;
    if (typeof fn === "function") {
      return (arg: any) => fn(arg?.chat || chat || arg);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Calienta el historial del chat: abre, sync del teléfono, loadEarlier y clic DOM.
 * Sin esto solo se importan los msgs ya en memoria (~1 reciente).
 */
async function ensureChatHistoryLoaded(
  WPP: any,
  chatId: string,
  targetCount: number
): Promise<void> {
  let chat = await loadChatModel(WPP, chatId);
  if (!chat) return;

  try {
    if (typeof WPP.chat.openChatBottom === "function") {
      await WPP.chat.openChatBottom(chatId);
      await sleep(700);
      chat = (await loadChatModel(WPP, chatId)) || chat;
    }
  } catch (err: any) {
    console.warn("[ChatDetector] openChatBottom:", err?.message || err);
  }

  // 1) Vaciar lo que ya está en DB local
  await loadEarlierMsgsRounds(chat, targetCount, 28);
  await scrollMsgPaneUp(4);

  chat = (await loadChatModel(WPP, chatId)) || chat;
  let localCount = getChatMsgModels(chat).length;
  const eoh = Number(chat?.endOfHistoryTransferType);
  // 0 = WA indica que aún se puede pedir historial al teléfono (botón visible)
  const phoneMayHaveMore = eoh === 0 || localCount < Math.min(targetCount, 40);

  if (phoneMayHaveMore && localCount < targetCount) {
    const synced = await triggerHistorySyncOnDemand(WPP, chat);
    const clicked = clickLoadOlderMessagesButton();

    if (synced || clicked) {
      for (let w = 0; w < 14; w++) {
        await sleep(550);
        chat = (await loadChatModel(WPP, chatId)) || chat;
        await loadEarlierMsgsRounds(chat, targetCount, 6);
        await scrollMsgPaneUp(2);
        localCount = getChatMsgModels(chat).length;
        if (localCount >= targetCount) break;
        // Reintentar clic si el banner sigue
        if (w % 2 === 1) clickLoadOlderMessagesButton();
      }
    } else {
      // Último recurso: solo scroll + loadEarlier
      for (let w = 0; w < 6; w++) {
        await scrollMsgPaneUp(3);
        chat = (await loadChatModel(WPP, chatId)) || chat;
        const before = getChatMsgModels(chat).length;
        await loadEarlierMsgsRounds(chat, targetCount, 5);
        if (getChatMsgModels(chat).length <= before) break;
      }
    }
  }

  console.log(
    `[ChatDetector] Historial calentado ${chatId}: ${getChatMsgModels(
      (await loadChatModel(WPP, chatId)) || chat
    ).length} msgs en memoria (objetivo ${targetCount})`
  );
}

function msgKey(m: any): string {
  const id = m?.id?._serialized || (typeof m?.id === "string" ? m.id : "");
  if (id) return id;
  return `t:${m?.t || 0}:${m?.fromMe ? 1 : 0}:${String(m?.body || "").slice(0, 40)}`;
}

/** Une getMessages + paginación before + msgs locales. */
async function collectMessages(
  WPP: any,
  chatId: string,
  count: number,
  options: { direction?: "before" | "after"; id?: string }
): Promise<any[]> {
  const byId = new Map<string, any>();
  const add = (list: any[]) => {
    for (const m of list || []) {
      if (!m) continue;
      byId.set(msgKey(m), m);
    }
  };

  try {
    const msgs = await WPP.chat.getMessages(chatId, {
      count: options.id ? Math.min(count, 80) : Math.min(count, 200),
      direction: options.direction || "before",
      id: options.id,
    });
    if (Array.isArray(msgs)) add(msgs);
  } catch (err: any) {
    console.warn("[ChatDetector] getMessages:", err?.message || err);
  }

  // Paginación hacia atrás si pidieron un bloque grande sin id concreto
  if (!options.id && byId.size > 0 && byId.size < count) {
    for (let guard = 0; guard < 12 && byId.size < count; guard++) {
      const sorted = [...byId.values()].sort(
        (a, b) => Number(a?.t || 0) - Number(b?.t || 0)
      );
      const oldestId = sorted[0]?.id?._serialized;
      if (!oldestId) break;
      const before = byId.size;
      try {
        const more = await WPP.chat.getMessages(chatId, {
          count: Math.min(60, count - byId.size),
          direction: "before",
          id: oldestId,
        });
        if (!Array.isArray(more) || more.length === 0) break;
        add(more);
      } catch {
        break;
      }
      if (byId.size <= before) break;
    }
  }

  const chat = await loadChatModel(WPP, chatId);
  add(getChatMsgModels(chat));

  // MsgStore global
  try {
    const store =
      (WPP as any).whatsapp?.MsgStore || (WPP as any).whatsapp?.MsgCollection;
    const all =
      store?.getModelsArray?.() ||
      (typeof store?.toArray === "function" ? store.toArray() : []);
    if (Array.isArray(all) && all.length) {
      add(
        all.filter((m: any) => {
          const remote =
            m?.id?.remote?._serialized ||
            m?.id?.remote ||
            m?.from?._serialized ||
            m?.to?._serialized;
          return String(remote) === chatId;
        })
      );
    }
  } catch {
    /* ignore */
  }

  return [...byId.values()]
    .sort((a, b) => Number(a?.t || 0) - Number(b?.t || 0))
    .slice(-Math.max(1, count));
}

export async function getChatMessages(
  chatId: string,
  options: {
    count?: number;
    direction?: "before" | "after";
    id?: string;
    /** Abre el chat, sync del teléfono y loadEarlier antes de leer. */
    warmHistory?: boolean;
  } = {}
): Promise<any[]> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  patchWhatsAppCompat(WPP);

  const count = options.count || 50;

  if (options.warmHistory) {
    try {
      await ensureChatHistoryLoaded(WPP, chatId, count);
    } catch (err: any) {
      console.warn("[ChatDetector] warmHistory:", err?.message || err);
    }
  }

  const collected = await collectMessages(WPP, chatId, count, {
    direction: options.direction,
    id: options.id,
  });
  if (collected.length > 0) {
    return collected.map(normalizeMessage);
  }

  return [];
}

function normalizeChat(chat: any): any {
  let id = chat.id;
  if (typeof id === "string") {
    id = { _serialized: id, server: id.split("@")[1], user: id.split("@")[0] };
  }

  return {
    chatId: id?._serialized,
    user: id?.user,
    server: id?.server,
    name: chat.name || chat.formattedTitle || chat.contact?.displayName || "",
    isGroup: id?.server === "g.us",
    canSend: chat.canSend ?? true,
    unreadCount: chat.unreadCount || 0,
    labels: (chat.labels || []).map((l: any) => (typeof l === "string" ? l : l.id)),
    timestamp: chat.t || chat.lastMessage?.t,
    lastMessage: chat.lastMessage ? normalizeMessage(chat.lastMessage) : undefined,
    pin: chat.pin,
    mute: chat.mute,
  };
}

/** Payload liviano para importación de historial (evita timeout por postMessage gigante). */
function normalizeChatSlim(chat: any): any {
  let id = chat.id;
  if (typeof id === "string") {
    id = { _serialized: id, server: id.split("@")[1], user: id.split("@")[0] };
  }
  const name = chat.name || chat.formattedTitle || chat.contact?.displayName || "";
  const labels = (chat.labels || [])
    .map((l: any) => (typeof l === "string" ? l : l?.id ?? l?.name))
    .filter(Boolean)
    .slice(0, 10);

  return {
    chatId: id?._serialized,
    user: id?.user,
    server: id?.server,
    name,
    isGroup: id?.server === "g.us",
    labels,
    timestamp: chat.t || chat.lastMessage?.t,
  };
}

function normalizeMessage(msg: any): any {
  let author: any = undefined;
  if (msg.__x_author) {
    author = {
      device: msg.__x_author.device,
      server: msg.__x_author.server,
      user: msg.__x_author.user,
      serialized: msg.__x_author._serialized,
    };
  }

  let body = msg.body || "";
  if (!body && ["image", "video", "document"].includes(msg.type)) {
    body = msg.caption || "";
  }

  const remote =
    msg.id?.remote?._serialized ||
    (typeof msg.id?.remote === "string" ? msg.id.remote : undefined);

  return {
    messageId: msg.id?._serialized || (typeof msg.id === "string" ? msg.id : undefined),
    chatId: remote,
    from: msg.from?._serialized || remote,
    to: msg.to?._serialized,
    body,
    type: msg.type,
    timestamp: msg.t,
    fromMe: msg.id?.fromMe || msg.fromMe || false,
    author,
    ack: msg.ack,
  };
}
