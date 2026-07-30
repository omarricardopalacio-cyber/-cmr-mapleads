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

async function postImportHistory(
  backendUrl: string,
  sessionToken: string,
  body: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`${backendUrl}${API_ENDPOINTS.POST_IMPORT_HISTORY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Token": sessionToken,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text?.slice(0, 200) };
  }
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export async function startHistoryImport(opts: ImportOptions): Promise<HistoryImportStatus> {
  if (status.running && runPromise) {
    return getHistoryImportStatus();
  }

  const maxChats = Math.max(1, Math.min(opts.maxChats ?? 50, 200));
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

      const list = await opts.sendWaCommand("GET_CHAT_LIST", {});
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

          const phone =
            chat.server === "c.us" && chat.user
              ? String(chat.user).replace(/\D/g, "")
              : chatId.endsWith("@c.us")
                ? chatId.split("@")[0].replace(/\D/g, "")
                : undefined;

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

      status.phase = stopRequested ? "done" : "done";
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
