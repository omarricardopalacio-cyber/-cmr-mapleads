// ============================================================
// MAPLE WA ENGINE — History Import (solo chats 1:1)
// No modifica polling, envío ni ingest en vivo.
// ============================================================

import { API_ENDPOINTS } from "../shared/contracts";

export type HistoryImportStatus = {
  running: boolean;
  stopped: boolean;
  phase: "idle" | "listing" | "importing" | "done" | "error";
  totalChats: number;
  processed: number;
  importedMessages: number;
  skippedChats: number;
  errors: number;
  currentChat: string | null;
  lastError: string | null;
  startedAt: number | null;
  finishedAt: number | null;
};

type ImportOptions = {
  maxChats?: number;
  messagesPerChat?: number;
  pauseMs?: number;
  backendUrl: string;
  sessionToken: string;
  sendWaCommand: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

const defaultStatus = (): HistoryImportStatus => ({
  running: false,
  stopped: false,
  phase: "idle",
  totalChats: 0,
  processed: 0,
  importedMessages: 0,
  skippedChats: 0,
  errors: 0,
  currentChat: null,
  lastError: null,
  startedAt: null,
  finishedAt: null,
});

let status: HistoryImportStatus = defaultStatus();
let stopRequested = false;
let runPromise: Promise<void> | null = null;

export function getHistoryImportStatus(): HistoryImportStatus {
  return { ...status };
}

export function stopHistoryImport(): HistoryImportStatus {
  stopRequested = true;
  status.stopped = true;
  void persistStatus();
  return getHistoryImportStatus();
}

async function persistStatus(): Promise<void> {
  try {
    await chrome.storage.local.set({ historyImportStatus: getHistoryImportStatus() });
  } catch {
    /* ignore */
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isGroupChat(chat: any): boolean {
  if (chat?.isGroup === true) return true;
  const id = String(chat?.chatId || "");
  return id.includes("@g.us") || String(chat?.server || "") === "g.us";
}

/** Extrae teléfono desde nombre tipo "+57 324 9722320" o desde JID @c.us */
function phoneFromChat(chat: any): string | undefined {
  if (chat?.server === "c.us" && chat?.user) {
    const d = String(chat.user).replace(/\D/g, "");
    if (d.length >= 8) return d;
  }
  const chatId = String(chat?.chatId || "");
  if (chatId.endsWith("@c.us")) {
    const d = chatId.split("@")[0].replace(/\D/g, "");
    if (d.length >= 8) return d;
  }
  const name = String(chat?.name || "");
  const m = name.match(/\+?\s*(\d{1,3}(?:[\s-]?\d{2,4}){2,5})\b/) || name.match(/\b(\d{10,15})\b/);
  if (m?.[1]) {
    const d = m[1].replace(/\D/g, "");
    if (d.length >= 8 && d.length <= 15) return d;
  }
  return undefined;
}

async function ensureBackendPermission(backendUrl: string): Promise<void> {
  try {
    const origin = new URL(backendUrl).origin + "/*";
    const have = await chrome.permissions.contains({ origins: [origin] });
    if (have) return;
    const granted = await chrome.permissions.request({ origins: [origin, "https://*/*"] });
    if (!granted) {
      throw new Error(
        "Chrome bloqueó el acceso al CRM. Recarga la extensión y acepta el permiso de host.",
      );
    }
  } catch (err: any) {
    // permissions.request desde SW a veces no muestra UI; seguimos e intentamos fetch
    console.warn("[HistoryImport] ensureBackendPermission:", err?.message || err);
  }
}

async function postImportHistory(
  backendUrl: string,
  sessionToken: string,
  body: Record<string, unknown>,
): Promise<any> {
  const base = backendUrl.replace(/\/$/, "");
  const url = `${base}${API_ENDPOINTS.POST_IMPORT_HISTORY}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": sessionToken,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Fallback: mismo canal que el ingest en vivo (suele tener permiso ya otorgado)
    return postImportViaIngest(base, sessionToken, body);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text?.slice(0, 200) };
  }
  if (!res.ok) {
    // Si el endpoint nuevo falla, intentar ingest
    if (res.status >= 500 || res.status === 404) {
      return postImportViaIngest(base, sessionToken, body);
    }
    throw new Error(data?.error || `HTTP ${res.status} en import-history`);
  }
  return data;
}

/** Guarda historial vía /ingest (ruta ya usada por la extensión en vivo). */
async function postImportViaIngest(
  backendUrl: string,
  sessionToken: string,
  body: Record<string, unknown>,
): Promise<any> {
  const chatId = String(body.chatId || "");
  const contact = (body.contact || {}) as Record<string, unknown>;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const labels = Array.isArray(body.labels) ? body.labels : [];

  const events = messages.map((m: any, idx: number) => {
    const fromMe = m.fromMe === true || m.direction === "out";
    const isLast = idx === messages.length - 1;
    return {
      type: fromMe ? "message-out" : "message-in",
      chatId,
      waMessageId: m.waMessageId || undefined,
      direction: fromMe ? "out" : "in",
      text: m.text || "",
      sentAt: m.sentAt,
      historical: true,
      historicalClassify: isLast,
      contact: {
        waId: contact.waId || chatId,
        displayName: contact.displayName || undefined,
        phone: contact.phone || undefined,
      },
      labels,
    };
  });

  if (!events.length) {
    return { ok: true, imported: 0, skipped: 0, via: "ingest-empty" };
  }

  // ingest acepta máx 50 por request
  let imported = 0;
  for (let i = 0; i < events.length; i += 45) {
    const chunk = events.slice(i, i + 45);
    // Solo el último chunk lleva classify en su último evento
    if (i + 45 < events.length) {
      chunk.forEach((e: any) => {
        e.historicalClassify = false;
      });
    }
    const res = await fetch(`${backendUrl}${API_ENDPOINTS.POST_INGEST}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": sessionToken,
      },
      body: JSON.stringify({ events: chunk }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`ingest fallback HTTP ${res.status}: ${t.slice(0, 180)}`);
    }
    imported += chunk.length;
  }

  return { ok: true, imported, skipped: 0, via: "ingest" };
}

export async function startHistoryImport(opts: ImportOptions): Promise<HistoryImportStatus> {
  if (status.running && runPromise) {
    return getHistoryImportStatus();
  }

  const maxChats = Math.max(1, Math.min(opts.maxChats ?? 50, 100));
  const messagesPerChat = Math.max(1, Math.min(opts.messagesPerChat ?? 50, 50));
  const pauseMs = Math.max(400, Math.min(opts.pauseMs ?? 900, 5000));

  stopRequested = false;
  status = {
    ...defaultStatus(),
    running: true,
    phase: "listing",
    startedAt: Date.now(),
  };
  await persistStatus();

  runPromise = (async () => {
    try {
      if (!opts.backendUrl || !opts.sessionToken) {
        throw new Error("Configura backend URL y session token");
      }

      await ensureBackendPermission(opts.backendUrl);

      // Smoke test: si ni ingest responde, fallar claro
      try {
        const ping = await fetch(`${opts.backendUrl.replace(/\/$/, "")}${API_ENDPOINTS.POST_INGEST}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Session-Token": opts.sessionToken,
          },
          body: JSON.stringify({ events: [{ type: "heartbeat", text: "history-ping" }] }),
        });
        if (ping.status === 401) {
          throw new Error("Session Token inválido. Revisa Config.");
        }
      } catch (err: any) {
        if (String(err?.message || "").includes("Session Token")) throw err;
        throw new Error(
          `No hay conexión con el CRM (${opts.backendUrl}). Quita y vuelve a cargar la extensión descomprimida desde /dist y acepta permisos.`,
        );
      }

      const list = await opts.sendWaCommand("GET_CHAT_LIST", {
        limit: maxChats,
        slim: true,
      });
      if (list?.error) throw new Error(String(list.error));
      if (!Array.isArray(list)) throw new Error("GET_CHAT_LIST no devolvió lista");

      const chats = list.filter((c: any) => !isGroupChat(c)).slice(0, maxChats);
      status.totalChats = chats.length;
      status.phase = "importing";
      await persistStatus();

      for (const chat of chats) {
        if (stopRequested) break;

        const chatId = String(chat.chatId || "");
        if (!chatId || isGroupChat(chat)) {
          status.skippedChats++;
          status.processed++;
          await persistStatus();
          continue;
        }

        status.currentChat = chat.name || chatId;
        await persistStatus();

        try {
          const msgsRaw = await opts.sendWaCommand("GET_CHAT_MESSAGES", {
            chatId,
            options: { count: messagesPerChat },
          });
          if (msgsRaw?.error) throw new Error(String(msgsRaw.error));
          const msgs = Array.isArray(msgsRaw) ? msgsRaw : [];

          const phone = phoneFromChat(chat);

          const payload = {
            chatId,
            contact: {
              waId: chatId,
              displayName: chat.name || undefined,
              phone: phone || undefined,
            },
            labels: Array.isArray(chat.labels)
              ? chat.labels.map((l: any) => String(l)).filter(Boolean).slice(0, 10)
              : [],
            classify: true,
            messages: msgs.map((m: any) => ({
              waMessageId: m.messageId || m.id || undefined,
              text: m.body || m.text || "",
              fromMe: !!m.fromMe,
              direction: m.fromMe ? "out" : "in",
              sentAt: m.timestamp,
              type: m.type,
            })),
          };

          const result = await postImportHistory(opts.backendUrl, opts.sessionToken, payload);
          status.importedMessages += Number(result?.imported || 0);
          if (result?.skipped === true || result?.error === "groups_not_allowed") {
            status.skippedChats++;
          }
        } catch (err: any) {
          status.errors++;
          status.lastError = err?.message || String(err);
          console.warn("[HistoryImport] chat failed:", chatId, status.lastError);
        }

        status.processed++;
        await persistStatus();
        await sleep(pauseMs + Math.floor(Math.random() * 300));
      }

      status.phase = "done";
      status.running = false;
      status.finishedAt = Date.now();
      status.currentChat = null;
      await persistStatus();
    } catch (err: any) {
      status.phase = "error";
      status.running = false;
      status.lastError = err?.message || String(err);
      status.finishedAt = Date.now();
      await persistStatus();
    } finally {
      runPromise = null;
    }
  })();

  return getHistoryImportStatus();
}
