// ============================================================
// MAPLE WA ENGINE — Background Service Worker
// Coordina tabs, backend API, storage y alarms
// ============================================================

import { BackgroundBridge } from "../bridge/bridge";
import { API_ENDPOINTS, CONSTANTS } from "../shared/contracts";
import type { BackendCommand, WAEvent, IngestPayload, SessionInfo } from "../shared/types";
import {
  saveSession,
  updateSessionHeartbeat,
  getActiveSession,
} from "../storage/db";

// Estado del service worker
let sessionToken: string | null = null;
let backendUrl: string | null = null;
let activeSessions: Map<string, SessionInfo> = new Map();

// Inicializar bridge
const bridge = new BackgroundBridge();
bridge.init();

// ============================================================
// Keep-Alive — Puerto persistente desde Content Script (MV3)
// ============================================================

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "maple-keep-alive") return;

  console.log("[MAPLE SW] Conexión de persistencia establecida desde el Content Script.");

  port.onMessage.addListener((message) => {
    if (message?.type === "PING") {
      chrome.storage.local.set({ lastKeepAlive: Date.now() });
    }
  });

  port.onDisconnect.addListener(() => {
    console.log("[MAPLE SW] Conexión de persistencia finalizada.");
  });
});

// ============================================================
// Config persistence (igual que extensión vieja)
// ============================================================

async function loadConfig(): Promise<void> {
  const cfg = await chrome.storage.local.get(["backendUrl", "sessionToken"]);
  backendUrl = (cfg.backendUrl || "").replace(/\/$/, "") || null;
  sessionToken = cfg.sessionToken || null;
  console.log("[ServiceWorker] Config cargada:", { backendUrl, hasToken: !!sessionToken });
  await restoreSession();
}

async function restoreSession(): Promise<void> {
  try {
    const session = await getActiveSession();
    if (session) {
      activeSessions.set(session.sessionId, session);
      console.log("[ServiceWorker] Sesión restaurada desde storage:", session.sessionId);
    }
  } catch (err) {
    console.warn("[ServiceWorker] No se pudo restaurar sesión:", err);
  }
}

async function saveConfig(url: string, token: string): Promise<void> {
  const cleanUrl = url.replace(/\/$/, "");
  await chrome.storage.local.set({ backendUrl: cleanUrl, sessionToken: token });
  backendUrl = cleanUrl;
  sessionToken = token;
  console.log("[ServiceWorker] Config guardada");
}

// ============================================================
// Lifecycle
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ServiceWorker] Extensión instalada/actualizada");
  loadConfig().then(setupAlarms);
  // Nota: MV3 inyecta content scripts automáticamente en páginas nuevas.
  // Para tabs existentes, el usuario debe recargar web.whatsapp.com.
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[ServiceWorker] Navegador iniciado");
  loadConfig().then(setupAlarms);
});

chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.backendUrl || changes.sessionToken) {
    await loadConfig();
    await pollCommands();
  }
});

// Bootstrap también en cold start del SW
loadConfig().then(setupAlarms);

// ============================================================
// Alarms
// ============================================================

function setupAlarms(): void {
  chrome.alarms.create("polling", { periodInMinutes: 0.05 }); // 3 segundos
  chrome.alarms.create("heartbeat", { periodInMinutes: 0.25 }); // 15 segundos
  chrome.alarms.create("flush_ingest", { periodInMinutes: 0.083 }); // 5 segundos
  chrome.alarms.create("cleanup", { periodInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case "polling":
      await pollCommands();
      break;
    case "heartbeat":
      await sendHeartbeat();
      break;
    case "flush_ingest":
      await flushIngestQueue();
      break;
    case "cleanup":
      await cleanupOldData();
      break;
  }
});

// ============================================================
// Polling — Obtener comandos del backend
// ============================================================

async function pollCommands(): Promise<void> {
  if (!backendUrl || !sessionToken) {
    await chrome.storage.local.set({ wsStatus: "disconnected", lastError: "not_configured" });
    return;
  }

  try {
    const res = await fetch(`${backendUrl}${API_ENDPOINTS.GET_COMMANDS}`, {
      method: "GET",
      headers: { "X-Session-Token": sessionToken || "" },
    });
    if (!res.ok) {
      await chrome.storage.local.set({ wsStatus: "disconnected", lastError: `commands ${res.status}` });
      return;
    }
    await chrome.storage.local.set({ wsStatus: "connected", lastPoll: Date.now(), lastError: null });
    const { commands = [] } = await res.json();
    for (const cmd of commands) {
      await dispatchCommand(cmd);
    }
  } catch (e: any) {
    await chrome.storage.local.set({ wsStatus: "disconnected", lastError: String(e?.message || e) });
  }
}

async function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchUrlToDataUri(url: string, fallbackMime?: string): Promise<{ dataUri: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch media URL: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  const mimeType = response.headers.get("content-type") || fallbackMime || "application/octet-stream";
  return { dataUri: `data:${mimeType};base64,${base64}`, mimeType };
}

async function resolveMediaInServiceWorker(
  payload: Record<string, unknown>
): Promise<{ payload: Record<string, unknown>; error?: string }> {
  const url = (payload.mediaUrl || payload.media_url) as string | undefined;
  if (!url || !url.startsWith("http")) {
    return { payload };
  }

  try {
    console.log("[ServiceWorker] Remote media URL detectada, convirtiendo a data URI:", url);
    const mimeType = (payload.mimeType || payload.mime_type) as string | undefined;
    const { dataUri } = await fetchUrlToDataUri(url, mimeType);
    return {
      payload: {
        ...payload,
        media: dataUri,
        mediaUrl: dataUri,
        mimeType: mimeType || undefined,
      },
    };
  } catch (err: any) {
    console.error("[ServiceWorker] No se pudo convertir media remota a data URI:", err);
    return { payload, error: err?.message || String(err) };
  }
}

async function dispatchCommand(cmd: BackendCommand): Promise<void> {
  const normalizedType = typeof cmd.type === "string"
    ? (cmd.type.toUpperCase() as BackendCommand["type"])
    : cmd.type;
  const command: BackendCommand = { ...cmd, type: normalizedType };

  console.log("[ServiceWorker] Comando recibido:", command.type, cmd.id);

  let payload = command.payload;
  if ((command.type === "SEND_MESSAGE" || command.type === "SEND_MEDIA") && (payload.mediaUrl || payload.media_url)) {
    const resolved = await resolveMediaInServiceWorker(payload);
    if (resolved.error) {
      console.error("[ServiceWorker] Abortando comando por fallo de descarga de media:", resolved.error);
      await sendCommandAck(command, { error: resolved.error });
      return;
    }
    payload = resolved.payload;
  }

  // Enviar comando a la tab de WhatsApp Web correspondiente
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });

  if (tabs.length === 0) {
    console.warn("[ServiceWorker] No hay tabs de WhatsApp Web abiertas");
    await sendCommandAck(command, { error: "no_whatsapp_tab" });
    return;
  }

  // Si hay targetSessionId, buscar tab con esa sesión
  let targetTab = tabs[0];
  if (cmd.targetSessionId) {
    const matching = tabs.find((t) => {
      const session = activeSessions.get(cmd.targetSessionId!);
      return session && t.id !== undefined;
    });
    if (matching) targetTab = matching;
  }

  if (!targetTab.id) {
    console.warn("[ServiceWorker] No se encontró tab válida para el comando");
    await sendCommandAck(command, { error: "invalid_target_tab" });
    return;
  }

  try {
    // Enviar comando y ESPERAR respuesta del content script
    const response = await chrome.tabs.sendMessage(targetTab.id, {
      source: "MAPLE_WA_BACKGROUND",
      direction: "BACKGROUND_TO_CONTENT",
      channel: "WA_COMMAND",
      id: cmd.id,
      event: cmd.type,
      payload: payload,
    });

    console.log("[ServiceWorker] Comando ejecutado:", cmd.id, "respuesta:", JSON.stringify(response));

    // Enviar ACK al backend como evento de ingest
    await sendCommandAck(cmd, response);
  } catch (err) {
    console.warn("[ServiceWorker] Error enviando comando a tab:", err);
    // Enviar NACK (fallo) al backend
    await sendCommandAck(cmd, { error: String(err) });
  }
}

async function sendCommandAck(cmd: BackendCommand, result: any): Promise<void> {
  if (!backendUrl || !sessionToken) return;

  const ackStatus = result?.error ? "error" : "ok";
  const ackSessionId =
    cmd.targetSessionId || activeSessions.values().next().value?.sessionId || "default";
  const ackEvent = {
    sessionId: ackSessionId,
    browserId: "chrome",
    deviceId: "",
    events: [{
      id: `ack-${cmd.id}-${Date.now()}`,
      type: "ack",
      commandId: cmd.id,
      ackStatus: ackStatus,
      payload: {
        commandId: cmd.id,
        commandType: cmd.type,
        status: ackStatus,
        result: result?.error ? undefined : result,
        error: result?.error,
        executedAt: Date.now(),
      },
      timestamp: Date.now(),
    }],
  };

  try {
    const res = await fetch(`${backendUrl}${API_ENDPOINTS.POST_INGEST}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": sessionToken || "",
      },
      body: JSON.stringify(ackEvent),
    });
    if (res.ok) {
      console.log("[ServiceWorker] ACK enviado al backend:", cmd.id);
    } else {
      console.warn("[ServiceWorker] ACK falló:", res.status);
    }
  } catch (e) {
    console.warn("[ServiceWorker] Error enviando ACK:", e);
  }
}

// ============================================================
// Heartbeat
// ============================================================

async function sendHeartbeat(): Promise<void> {
  if (!backendUrl || !sessionToken) return;

  for (const [sessionId, session] of activeSessions) {
    if (Date.now() - session.lastHeartbeat > CONSTANTS.HEARTBEAT_TIMEOUT_MS) {
      console.warn(`[ServiceWorker] Sesión ${sessionId} timeout, marcando como perdida`);
      activeSessions.delete(sessionId);
      continue;
    }

    try {
      await fetch(`${backendUrl}/api/public/engine/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": sessionToken || "",
        },
        body: JSON.stringify({
          sessionId: session.sessionId,
          browserId: session.browserId,
          deviceId: session.deviceId,
          timestamp: Date.now(),
        }),
      });
      await updateSessionHeartbeat(sessionId);
    } catch (err) {
      // Silenciar
    }
  }
}

// ============================================================
// Ingest — Enviar eventos al backend
// ============================================================

async function flushIngestQueue(): Promise<void> {
  if (!backendUrl || !sessionToken) return;

  // Leer eventos de chrome.storage.local (buffer temporal del bridge)
  const stored = await chrome.storage.local.get("eventQueue");
  const queue: any[] = stored.eventQueue || [];
  if (queue.length === 0) return;

  let batch = queue.slice(0, CONSTANTS.BATCH_MAX_SIZE) as WAEvent[];
  const heavyIdx = batch.findIndex((ev) => eventHasHeavyMedia(ev));
  if (heavyIdx >= 0) {
    batch = [batch[heavyIdx]];
  }

  function mapEventType(t: string): string {
    switch (t) {
      case "NEW_MESSAGE": return "message-in";
      case "MESSAGE_SENT": return "message-out";
      case "MESSAGE_ACK": return "ack";
      case "MESSAGE_FAILED": return "ack";
      case "SESSION_READY": return "heartbeat";
      case "SESSION_LOST": return "heartbeat";
      case "HEARTBEAT": return "heartbeat";
      default: return "status"; // CONNECTION_STATE_CHANGED, PRESENCE_CHANGED, etc.
    }
  }

  let activeSession = activeSessions.values().next().value;
  if (!activeSession) {
    const restored = await getActiveSession();
    if (restored) {
      activeSessions.set(restored.sessionId, restored);
      activeSession = restored;
      console.log("[ServiceWorker] Sesión restaurada antes de flushIngestQueue:", restored.sessionId);
    }
  }

  const sessionId = activeSession?.sessionId || "default";
  const phoneNumber = activeSession?.phoneNumber || "";

  const payload: IngestPayload = {
    sessionId,
    browserId: "chrome",
    deviceId: phoneNumber,
    events: batch.map((e) => {
      const flat = eventPayloadRecord(e as WAEvent);
      return {
        id: `${e.id}`,
        type: mapEventType(e.type) as any,
        chatId: flat.chatId as string | undefined,
        waMessageId: (flat.messageId ?? flat.waMessageId) as string | undefined,
        direction: (flat.direction as "in" | "out" | undefined) ?? (typeof flat.fromMe === "boolean" ? (flat.fromMe ? "out" : "in") : undefined),
        text: (flat.text ?? flat.body) as string | undefined,
        media: slimMediaForIngest(flat.media as Record<string, unknown> | undefined),
        contact: flat.contact as { waId: string; displayName?: string; phone?: string } | undefined,
        sentAt: flat.sentAt ?? flat.timestamp,
        payload: {
          fromMe: flat.fromMe as boolean | undefined,
          phoneNumber: (flat.phoneNumber as string) || phoneNumber,
          messageId: (flat.messageId ?? flat.waMessageId) as string | undefined,
          type: flat.type as string | undefined,
        },
        timestamp: e.timestamp,
      };
    }),
  };

  const bodyJson = JSON.stringify(payload);
  console.log("[ServiceWorker] Ingest body:", bodyJson.substring(0, 2000));

  try {
    const response = await fetch(`${backendUrl}${API_ENDPOINTS.POST_INGEST}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": sessionToken || "",
      },
      body: bodyJson,
    });

    if (response.ok) {
      // Remover eventos enviados de la cola
      const remaining = queue.slice(batch.length);
      await chrome.storage.local.set({ eventQueue: remaining });
      await chrome.storage.local.set({ wsStatus: "connected", lastFlush: Date.now() });
      console.log(`[ServiceWorker] Ingest: ${batch.length} eventos sincronizados, ${remaining.length} restantes`);
    } else {
      const errText = await response.text().catch(() => "");
      console.warn(`[ServiceWorker] Ingest error ${response.status}:`, errText.substring(0, 500));
      await chrome.storage.local.set({ lastError: `ingest ${response.status}: ${errText.substring(0, 200)}` });
    }
  } catch (err: any) {
    await chrome.storage.local.set({ wsStatus: "disconnected", lastError: String(err?.message || err) });
  }
}

// ============================================================
// Message Handler (desde Content Script)
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source !== "MAPLE_WA_CONTENT") return false;

  (async () => {
    switch (message.channel) {
      case "WA_EVENT":
        await handleWAEvent(message.payload as WAEvent, sender);
        sendResponse({ ok: true });
        break;

      case "WA_REQUEST":
        console.log("[ServiceWorker] WA_REQUEST recibido desde content:", message.event, message.payload);
        try {
          const result = await handleRequest(message);
          console.log("[ServiceWorker] WA_REQUEST result:", result?.mimeType ? { mimeType: result.mimeType, hasDataUri: !!result.dataUri } : result);
          sendResponse({ ok: true, payload: result });
        } catch (err: any) {
          console.error("[ServiceWorker] Error en WA_REQUEST handleRequest:", err);
          sendResponse({ ok: false, error: err?.message ?? String(err) });
        }
        break;

      case "CONFIG":
        await saveConfig(
          message.payload?.backendUrl || backendUrl,
          message.payload?.sessionToken || sessionToken || ""
        );
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, error: "Unknown channel" });
    }
  })();

  return true; // Async response
});

function eventPayloadRecord(event: WAEvent): Record<string, unknown> {
  const p = event.payload;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    const inner = (p as Record<string, unknown>).payload;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return { ...(p as Record<string, unknown>), ...(inner as Record<string, unknown>) };
    }
    return p as Record<string, unknown>;
  }
  return {};
}

function slimMediaForIngest(
  media: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!media) return undefined;
  const out = { ...media };
  const url = out.url as string | undefined;
  const hasHttpUrl = typeof url === "string" && url.startsWith("http") && !url.startsWith("blob:");
  if (hasHttpUrl) {
    delete out.base64;
    delete out.body;
    delete out.data;
    return out;
  }
  const b64 = (out.base64 || out.body || out.data) as unknown;
  if (typeof b64 === "string" && b64.length > CONSTANTS.MEDIA_INLINE_MAX_LEN) {
    delete out.base64;
    delete out.body;
    delete out.data;
    out.missing_media = true;
  }
  return out;
}

function eventHasHeavyMedia(event: WAEvent): boolean {
  const p = eventPayloadRecord(event);
  const media = p.media as Record<string, unknown> | undefined;
  if (!media) return false;
  const b64 = (media.base64 || media.body || media.data) as unknown;
  return typeof b64 === "string" && b64.length > CONSTANTS.MEDIA_INLINE_MAX_LEN;
}

async function uploadMediaToBackend(
  base64OrDataUri: string,
  mimeType: string,
  msgType?: string
): Promise<{ url: string; storagePath: string; mimeType: string } | null> {
  if (!backendUrl || !sessionToken) return null;
  try {
    const response = await fetch(`${backendUrl}${API_ENDPOINTS.POST_UPLOAD_MEDIA}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": sessionToken,
      },
      body: JSON.stringify({ data: base64OrDataUri, mimeType, msgType }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn("[MAPLE MULTIMEDIA] upload-media", response.status, errText.slice(0, 200));
      return null;
    }
    return (await response.json()) as { url: string; storagePath: string; mimeType: string };
  } catch (err) {
    console.warn("[MAPLE MULTIMEDIA] upload-media error:", err);
    return null;
  }
}

async function offloadHeavyMediaFromEvent(event: WAEvent): Promise<WAEvent> {
  const p = eventPayloadRecord(event);
  const media = p.media as Record<string, unknown> | undefined;
  if (!media) return event;

  const b64 = (media.base64 || media.body || media.data) as string | undefined;
  if (typeof b64 !== "string" || b64.length <= CONSTANTS.MEDIA_INLINE_MAX_LEN) return event;

  let mime = String(
    media.mimetype || media.mimeType || media.mime_type || "application/octet-stream"
  );
  const msgType = typeof media.type === "string" ? media.type : undefined;

  // FIX: Si el mime sigue siendo genérico, inferir por tipo de mensaje
  if (mime === "application/octet-stream" && msgType) {
    if (msgType === "image") mime = "image/jpeg";
    else if (msgType === "video") mime = "video/mp4";
    else if (msgType === "ptt" || msgType === "audio") mime = "audio/ogg";
    else if (msgType === "document") mime = "application/pdf";
  }

  const uploaded = await uploadMediaToBackend(b64, mime, msgType);
  if (!uploaded?.url) return event;

  const slimMedia: Record<string, unknown> = {
    ...media,
    url: uploaded.url,
    storagePath: uploaded.storagePath,
    mimeType: uploaded.mimeType,
    mime_type: uploaded.mimeType,
  };
  delete slimMedia.base64;
  delete slimMedia.body;
  delete slimMedia.data;

  return { ...event, payload: { ...p, media: slimMedia } };
}

async function handleWAEvent(event: WAEvent, _sender: chrome.runtime.MessageSender): Promise<void> {
  // Guardar en cola local (chrome.storage.local)
  try {
    let stored = event;
    if (eventHasHeavyMedia(event)) {
      console.log("[MAPLE MULTIMEDIA] Subiendo archivo a Storage antes de encolar...");
      stored = await offloadHeavyMediaFromEvent(event);
    }

    const result = await chrome.storage.local.get("eventQueue");
    const queue: any[] = result.eventQueue || [];
    queue.push(stored);
    if (queue.length > 500) queue.splice(0, queue.length - 500);
    await chrome.storage.local.set({ eventQueue: queue });

    if (eventHasHeavyMedia(event)) {
      console.log(
        "[MAPLE MULTIMEDIA] Despachando archivo multimedia pesado inmediatamente (Bypass de Cola Batch)..."
      );
      await flushIngestQueue();
    }
  } catch (err) {
    console.error("[ServiceWorker] Error guardando evento:", err);
  }

  // Si es SESSION_READY, registrar sesión activa
  if (event.type === "SESSION_READY" && event.payload) {
    const session: SessionInfo = {
      sessionId: event.payload.sessionId,
      browserId: event.payload.browserId,
      deviceId: event.payload.deviceId,
      phoneNumber: event.payload.phoneNumber,
      profileName: event.payload.profileName,
      profilePicture: event.payload.profilePicture,
      isReady: true,
      connectedAt: event.payload.connectedAt || Date.now(),
      lastHeartbeat: Date.now(),
    };
    activeSessions.set(session.sessionId, session);
    await saveSession(session);
  }
}

async function handleRequest(message: any): Promise<any> {
  const requestType = message.event || message.payload?.type;
  switch (requestType) {
    case "GET_SESSIONS":
      return Array.from(activeSessions.values());
    case "GET_QUEUE_SIZE":
      const result = await chrome.storage.local.get("eventQueue");
      const queue = result.eventQueue || [];
      return { queueSize: queue.length };
    case "GET_CONFIG":
      return {
        backendUrl: backendUrl || "",
        sessionToken: sessionToken || "",
      };
    case "FETCH_MEDIA": {
      const url = message.payload?.url;
      if (!url || typeof url !== "string") {
        throw new Error("FETCH_MEDIA requires a valid url");
      }
      console.log("[ServiceWorker] FETCH_MEDIA url:", url);
      const resp = await fetch(url);
      console.log("[ServiceWorker] FETCH_MEDIA http status:", resp.status, resp.statusText);
      if (!resp.ok) {
        throw new Error(`Failed to fetch media: ${resp.status}`);
      }
      const arrayBuffer = await resp.arrayBuffer();
      const mimeType =
        resp.headers.get("content-type") || message.payload?.mimeType || "application/octet-stream";
      const base64 = arrayBufferToBase64(arrayBuffer);
      const dataUri = `data:${mimeType};base64,${base64}`;
      console.log("[ServiceWorker] FETCH_MEDIA convertido a dataUri, size:", dataUri.length, "mimeType:", mimeType);
      return {
        dataUri,
        mimeType,
      };
    }
    default:
      return null;
  }
}

// ============================================================
// Cleanup
// ============================================================

async function cleanupOldData(): Promise<void> {
  try {
    // Limpiar eventos sync antiguos (más de 7 días)
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    // Dexie no soporta delete con compound where fácilmente,
    // así que usamos un approach simple
    console.log("[ServiceWorker] Cleanup ejecutado");
  } catch (err) {
    console.error("[ServiceWorker] Error cleanup:", err);
  }
}
