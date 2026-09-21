// ============================================================
// MAPLE WA ENGINE — Background Service Worker
// Coordina tabs, backend API, storage y alarms
// ============================================================

import { BackgroundBridge } from "../bridge/bridge";
import { API_ENDPOINTS, CONSTANTS, canonicalizeBackendUrl } from "../shared/contracts";
import { buildIngestContact, httpProfileUrl, sameProfilePicture } from "../shared/wa-identity";
import { linkIsUp, presentConnection, shouldMarkLinkDown } from "../shared/link-status";
import type { BackendCommand, WAEvent, IngestPayload, SessionInfo } from "../shared/types";
import {
  saveSession,
  updateSessionHeartbeat,
  getActiveSession,
  saveLocalMedia,
} from "../storage/db";
import {
  startHistoryImport,
  stopHistoryImport,
  getHistoryImportStatus,
} from "./history-import";

// Estado del service worker
let sessionToken: string | null = null;
let backendUrl: string | null = null;
let activeSessions: Map<string, SessionInfo> = new Map();
/** Fotos de la sesión (negocio / yo). No se adjuntan a contactos peer. */
let ownProfilePictureUrls: string[] = [];
/** Enlace con el backend. Un 504 suelto no pasa wsStatus a disconnected. */
let linkFailStreak = 0;
let lastLinkOkAt = 0;
let lastEngineOkAt = 0;
let lastSessionOkAt = 0;
let lastBridgeOkAt = 0;
let lastContentHealAt = 0;

function rememberOwnAvatars(values: unknown[]): void {
  let changed = false;
  for (const value of values) {
    const url = httpProfileUrl(value);
    if (!url) continue;
    if (ownProfilePictureUrls.some((known) => sameProfilePicture(known, url) || known === url)) continue;
    ownProfilePictureUrls.push(url);
    changed = true;
  }
  if (ownProfilePictureUrls.length > 8) ownProfilePictureUrls = ownProfilePictureUrls.slice(-8);
  if (changed) {
    void chrome.storage.local.set({ meProfilePictureUrls: ownProfilePictureUrls });
  }
}

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
  const cfg = await chrome.storage.local.get([
    "backendUrl",
    "sessionToken",
    "lastLinkOkAt",
    "linkFailStreak",
    "lastEngineOkAt",
    "lastSessionOkAt",
    "lastBridgeOkAt",
    "wsStatus",
    "lastPoll",
  ]);
  const storedUrl = typeof cfg.backendUrl === "string" ? cfg.backendUrl.trim().replace(/\/$/, "") : "";
  const canonical = canonicalizeBackendUrl(cfg.backendUrl);
  backendUrl = canonical;
  sessionToken = cfg.sessionToken || null;
  lastLinkOkAt = Number(cfg.lastLinkOkAt) || 0;
  if (!lastLinkOkAt && cfg.wsStatus === "connected") {
    lastLinkOkAt = Number(cfg.lastPoll) || Date.now();
  }
  linkFailStreak = Number(cfg.linkFailStreak) || 0;
  lastEngineOkAt = Number(cfg.lastEngineOkAt) || 0;
  lastSessionOkAt = Number(cfg.lastSessionOkAt) || 0;
  lastBridgeOkAt = Number(cfg.lastBridgeOkAt) || 0;
  const avatars = await chrome.storage.local.get("meProfilePictureUrls");
  if (Array.isArray(avatars.meProfilePictureUrls)) {
    rememberOwnAvatars(avatars.meProfilePictureUrls);
  }
  if (canonical && canonical !== storedUrl) {
    await chrome.storage.local.set({ backendUrl: canonical });
  }
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

let pollingTimer: any = null;
let flushTimer: any = null;
let isPollingLoopActive = false;
let isFlushLoopActive = false;

async function startFastPolling(): Promise<void> {
  if (CONSTANTS.USE_LEGACY_ALARMS) {
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
    isPollingLoopActive = false;
    return;
  }
  if (isPollingLoopActive) return;
  isPollingLoopActive = true;

  async function run() {
    if (CONSTANTS.USE_LEGACY_ALARMS) {
      isPollingLoopActive = false;
      return;
    }
    try {
      await pollCommands();
      await ensureWhatsAppContentScript();
    } catch (e) {
      console.warn("[FastPolling] Loop error:", e);
    }
    pollingTimer = setTimeout(run, CONSTANTS.POLLING_INTERVAL_MS);
  }

  run();
}

async function startFastFlush(): Promise<void> {
  if (CONSTANTS.USE_LEGACY_ALARMS) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    isFlushLoopActive = false;
    return;
  }
  if (isFlushLoopActive) return;
  isFlushLoopActive = true;

  async function run() {
    if (CONSTANTS.USE_LEGACY_ALARMS) {
      isFlushLoopActive = false;
      return;
    }
    try {
      await flushIngestQueue();
    } catch (e) {
      console.warn("[FastFlush] Loop error:", e);
    }
    flushTimer = setTimeout(run, CONSTANTS.BATCH_FLUSH_INTERVAL_MS);
  }

  run();
}

function initLoops(): void {
  setupAlarms();
  if (!CONSTANTS.USE_LEGACY_ALARMS) {
    console.log("[ServiceWorker] Iniciando bucles rápidos (Fast Polling & Fast Flush)...");
    startFastPolling();
    startFastFlush();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ServiceWorker] Extensión instalada/actualizada");
  loadConfig().then(initLoops);
  // Nota: MV3 inyecta content scripts automáticamente en páginas nuevas.
  // Para tabs existentes, el usuario debe recargar web.whatsapp.com.
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[ServiceWorker] Navegador iniciado");
  loadConfig().then(initLoops);
});

chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.backendUrl || changes.sessionToken) {
    await loadConfig();
    if (!CONSTANTS.USE_LEGACY_ALARMS) {
      startFastPolling();
      startFastFlush();
    } else {
      await pollCommands();
    }
  }
});

// Bootstrap también en cold start del SW
loadConfig().then(initLoops);

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
      if (CONSTANTS.USE_LEGACY_ALARMS) {
        await pollCommands();
      } else {
        // Alarm acts as watchdog/keep-alive helper
        startFastPolling();
      }
      break;
    case "heartbeat":
      await sendHeartbeat();
      break;
    case "flush_ingest":
      if (CONSTANTS.USE_LEGACY_ALARMS) {
        await flushIngestQueue();
      } else {
        // Alarm acts as watchdog/keep-alive helper
        startFastFlush();
      }
      break;
    case "cleanup":
      await cleanupOldData();
      break;
  }
});

// ============================================================
// Polling — Obtener comandos del backend
// ============================================================

function linkConfigured(): boolean {
  return !!(backendUrl && sessionToken);
}

async function markLinkOk(extra?: Record<string, unknown>): Promise<void> {
  linkFailStreak = 0;
  lastLinkOkAt = Date.now();
  await chrome.storage.local.set({
    wsStatus: "connected",
    lastLinkOkAt,
    linkFailStreak: 0,
    lastError: null,
    ...extra,
  });
}

async function markLinkFail(reason: string): Promise<void> {
  const configured = linkConfigured();
  if (!configured) {
    linkFailStreak = 0;
    await chrome.storage.local.set({ wsStatus: "disconnected", lastError: reason, linkFailStreak: 0 });
    return;
  }
  linkFailStreak += 1;
  const down = shouldMarkLinkDown({
    configured: true,
    failStreak: linkFailStreak,
    lastOkAt: lastLinkOkAt,
    now: Date.now(),
  });
  await chrome.storage.local.set({
    lastError: reason,
    linkFailStreak,
    ...(down ? { wsStatus: "disconnected" } : {}),
  });
}

async function pollCommands(): Promise<void> {
  if (!linkConfigured()) {
    await markLinkFail("not_configured");
    return;
  }

  try {
    const res = await fetch(`${backendUrl}${API_ENDPOINTS.GET_COMMANDS}`, {
      method: "GET",
      headers: { "X-Session-Token": sessionToken || "" },
    });
    if (!res.ok) {
      await markLinkFail(`commands ${res.status}`);
      return;
    }
    await markLinkOk({ lastPoll: Date.now() });
    const { commands = [] } = await res.json();
    for (const cmd of commands) {
      await dispatchCommand(cmd);
    }
  } catch (e: any) {
    await markLinkFail(String(e?.message || e));
  }
}

/** Si el content script murió (navegación de WA Web) lo reinyecta sin marcar el enlace caído. */
async function ensureWhatsAppContentScript(): Promise<void> {
  if (Date.now() - lastContentHealAt < 20_000) return;
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (!tab.id) continue;
    let alive = false;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { source: "MAPLE_WA_POPUP_PING" });
      alive = !!res?.contentScript;
    } catch {
      alive = false;
    }
    if (alive) continue;
    lastContentHealAt = Date.now();
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/index.js"],
      });
      console.log("[ServiceWorker] Content script reinjectado en", tab.id);
    } catch (err) {
      console.warn("[ServiceWorker] No se pudo reinjectar el content script:", err);
    }
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

async function sendWaCommandToTab(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<any> {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (tabs.length === 0 || !tabs[0]?.id) {
    throw new Error("no_whatsapp_tab");
  }
  const id = `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return await chrome.tabs.sendMessage(tabs[0].id, {
    source: "MAPLE_WA_BACKGROUND",
    direction: "BACKGROUND_TO_CONTENT",
    channel: "WA_COMMAND",
    id,
    event: type,
    payload,
  });
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
    // 45s era poco: un SW dormido o un POST fallido borraba la sesión y el punto Session se apagaba.
    if (Date.now() - session.lastHeartbeat > 3 * 60_000) {
      console.warn(`[ServiceWorker] Sesión ${sessionId} sin heartbeat local 3 min, soltando memoria`);
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
    // Mantener orden causal: primero debe llegar la cáscara NEW_MESSAGE y
    // después mediaRecovery. Antes se extraía el evento pesado de la mitad
    // del lote y podía insertarse el audio corrupto antes del mensaje base.
    batch = heavyIdx === 0 ? [batch[0]] : batch.slice(0, heavyIdx);
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
      case "CONTACT_INFO": return "CONTACT_INFO";
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
      const fromMe = flat.fromMe as boolean | undefined;
      const inferredType =
        e.type === "NEW_MESSAGE" && fromMe ? "message-out" : mapEventType(e.type);

      const existingContact =
        flat.contact && typeof flat.contact === "object"
          ? (flat.contact as Record<string, unknown>)
          : undefined;

      // El teléfono siempre debe salir del interlocutor. En mensajes entrantes
      // `to` somos nosotros; usarlo como fallback creaba un contacto con el
      // número de la sesión y hacía que los flujos se enviaran al chat "(Tú)".
      const counterpartJid =
        fromMe === true
          ? flat.to || flat.chatId
          : fromMe === false
            ? flat.from || flat.chatId
            : flat.chatId;

      const displayName =
        (existingContact?.displayName as string | undefined) ||
        (flat.displayName as string | undefined) ||
        (flat.pushname as string | undefined) ||
        (flat.notifyName as string | undefined);

      const eventOwnAvatars = [
        ...ownProfilePictureUrls,
        flat.meProfilePictureUrl,
        ...(Array.isArray(flat.meProfilePictureUrls) ? flat.meProfilePictureUrls : []),
        activeSession?.profilePicture,
      ];
      rememberOwnAvatars(eventOwnAvatars);

      const identity = buildIngestContact({
        counterpartJid,
        contactWaId: existingContact?.waId || flat.chatId || flat.waId,
        contactPhone: existingContact?.phone ?? flat.phone,
        displayName,
        profilePictureUrl: existingContact?.profilePictureUrl,
        extraProfilePictureUrl: flat.profilePictureUrl,
        ownProfilePictureUrls: ownProfilePictureUrls,
        keepLidKey: e.type === "CONTACT_INFO" || inferredType === "CONTACT_INFO",
      });
      const chatId = identity.chatId;
      const phone = identity.phone;
      const contact = identity.contact;

      return {
        id: `${e.id}`,
        type: inferredType as any,
        chatId,
        waMessageId: (flat.messageId ?? flat.waMessageId) as string | undefined,
        direction:
          (flat.direction as "in" | "out" | undefined) ??
          (typeof fromMe === "boolean" ? (fromMe ? "out" : "in") : undefined),
        text: (flat.text ?? flat.body) as string | undefined,
        media: slimMediaForIngest(flat.media as Record<string, unknown> | undefined),
        contact: contact?.waId ? contact : undefined,
        sentAt: flat.sentAt ?? flat.timestamp,
        mediaRecovery: flat.mediaRecovery as boolean | undefined,
        payload: {
          fromMe: flat.fromMe as boolean | undefined,
          from: flat.from as string | undefined,
          to: flat.to as string | undefined,
          chatId,
          // Telemetría de la sesión: nunca reemplazarla con el teléfono del cliente.
          phoneNumber: (flat.phoneNumber as string) || phoneNumber,
          phone,
          pushname: flat.pushname as string | undefined,
          notifyName: flat.notifyName as string | undefined,
          displayName,
          profilePictureUrl: contact?.profilePictureUrl,
          messageId: (flat.messageId ?? flat.waMessageId) as string | undefined,
          type: flat.type as string | undefined,
          waId: contact?.waId,
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
      await markLinkOk({ lastFlush: Date.now() });
      console.log(`[ServiceWorker] Ingest: ${batch.length} eventos sincronizados, ${remaining.length} restantes`);
    } else {
      const errText = await response.text().catch(() => "");
      console.warn(`[ServiceWorker] Ingest error ${response.status}:`, errText.substring(0, 500));
      // 504/5xx no pisa un poll sano: solo cuenta si se sostiene. El poll exitoso lo perdona.
      await markLinkFail(`ingest ${response.status}: ${errText.substring(0, 180)}`);
    }
  } catch (err: any) {
    await markLinkFail(String(err?.message || err));
  }
}

// ============================================================
// Message Handler (desde Content Script)
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Popup y content usan el mismo canal de requests hacia el SW
  if (message?.source !== "MAPLE_WA_CONTENT" && message?.source !== "MAPLE_WA_POPUP") {
    return false;
  }

  (async () => {
    switch (message.channel) {
      case "WA_EVENT":
        if (message.source !== "MAPLE_WA_CONTENT") {
          sendResponse({ ok: false, error: "events_only_from_content" });
          break;
        }
        await handleWAEvent(message.payload as WAEvent, sender);
        sendResponse({ ok: true });
        break;

      case "WA_REQUEST":
        console.log("[ServiceWorker] WA_REQUEST recibido:", message.source, message.event, message.payload);
        try {
          const result = await handleRequest(message);
          console.log(
            "[ServiceWorker] WA_REQUEST result:",
            result?.mimeType
              ? { mimeType: result.mimeType, hasDataUri: !!result.dataUri }
              : result,
          );
          sendResponse({ ok: true, payload: result });
        } catch (err: any) {
          console.error("[ServiceWorker] Error en WA_REQUEST handleRequest:", err);
          sendResponse({ ok: false, error: err?.message ?? String(err) });
        }
        break;

      case "CONFIG":
        await saveConfig(
          message.payload?.backendUrl || backendUrl,
          message.payload?.sessionToken || sessionToken || "",
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
  if (hasHttpUrl || out.localOnly === true) {
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

function eventHasMediaBase64(event: WAEvent): boolean {
  const p = eventPayloadRecord(event);
  const media = p.media as Record<string, unknown> | undefined;
  if (!media) return false;
  if (media.localOnly === true && media.localRef) return false;
  const b64 = (media.base64 || media.body || media.data) as unknown;
  return typeof b64 === "string" && b64.length > 64;
}

function eventHasHeavyMedia(event: WAEvent): boolean {
  return eventHasMediaBase64(event);
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
  if (typeof b64 !== "string" || b64.length < 64) return event;

  let mime = String(
    media.mimetype || media.mimeType || media.mime_type || "application/octet-stream"
  );
  const msgType = typeof media.type === "string" ? media.type : undefined;

  if (mime === "application/octet-stream" && msgType) {
    if (msgType === "image") mime = "image/jpeg";
    else if (msgType === "video") mime = "video/mp4";
    else if (msgType === "ptt" || msgType === "audio") mime = "audio/ogg";
    else if (msgType === "document") mime = "application/pdf";
  }

  const isAudio =
    mime.startsWith("audio/") || msgType === "ptt" || msgType === "audio";
  const waMessageId = String(
    p.messageId || p.waMessageId || event.id || `local-${Date.now()}`
  );
  const chatId = String(p.chatId || p.from || p.to || "unknown");

  // Siempre guardar en el PC (IndexedDB).
  let localRef = waMessageId;
  try {
    const saved = await saveLocalMedia({
      waMessageId,
      chatId,
      base64: b64,
      mimeType: mime,
      type: msgType,
      filename: (media.filename || media.fileName) as string | undefined,
      direction: p.direction as string | undefined,
      text: (p.text || p.body) as string | undefined,
    });
    localRef = saved.id;
    console.log("[MAPLE MULTIMEDIA] Guardado en PC:", localRef, saved.size, "bytes");
  } catch (err) {
    console.warn("[MAPLE MULTIMEDIA] Error guardando en PC:", err);
  }

  // Solo audios van temporalmente a la nube (Whisper). Fotos/videos/docs = solo PC.
  if (isAudio) {
    console.log("[MAPLE MULTIMEDIA] Subiendo audio temporal a Storage para transcripción...");
    // Reintentos: NO dejamos base64 en chrome.storage (cuota ~10MB y puede tumbar la cola).
    // El listener de WhatsApp no se toca; esto corre solo en el service worker.
    let uploaded: { url: string; storagePath: string; mimeType: string } | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      uploaded = await uploadMediaToBackend(b64, mime, msgType);
      if (uploaded?.url) break;
      console.warn(
        `[MAPLE MULTIMEDIA] Upload audio intento ${attempt}/3 falló; reintentando...`
      );
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt));
    }
    if (uploaded?.url) {
      const slimMedia: Record<string, unknown> = {
        ...media,
        url: uploaded.url,
        storagePath: uploaded.storagePath,
        mimeType: uploaded.mimeType,
        mime_type: uploaded.mimeType,
        localRef,
        storedLocally: true,
      };
      delete slimMedia.base64;
      delete slimMedia.body;
      delete slimMedia.data;
      return { ...event, payload: { ...p, media: slimMedia } };
    }
    console.warn(
      "[MAPLE MULTIMEDIA] Upload audio falló tras reintentos; enviando localOnly (sin base64 en cola)"
    );

    // Respaldo seguro para notas cortas: si caben dentro del límite de la
    // cola, dejar que /ingest haga el upload/transcripción. No se aplica a
    // audios grandes para evitar superar la cuota de chrome.storage.
    if (b64.length <= CONSTANTS.MEDIA_INLINE_MAX_LEN) {
      console.warn(
        "[MAPLE MULTIMEDIA] Audio corto: fallback inline hacia ingest",
        b64.length,
        "chars",
      );
      return {
        ...event,
        payload: {
          ...p,
          media: {
            ...media,
            base64: b64,
            localRef,
            storedLocally: true,
            localOnly: false,
            missing_media: false,
            mimeType: mime,
            mime_type: mime,
            type: msgType || media.type,
          },
        },
      };
    }
  }

  const localOnlyMedia: Record<string, unknown> = {
    ...media,
    url: null,
    localOnly: true,
    localRef,
    storedLocally: true,
    mimeType: mime,
    mime_type: mime,
    type: msgType || media.type,
    size: Math.floor((b64.length * 3) / 4),
  };
  delete localOnlyMedia.base64;
  delete localOnlyMedia.body;
  delete localOnlyMedia.data;

  return { ...event, payload: { ...p, media: localOnlyMedia } };
}

async function handleWAEvent(event: WAEvent, _sender: chrome.runtime.MessageSender): Promise<void> {
  // Guardar en cola local (chrome.storage.local)
  try {
    const flat = eventPayloadRecord(event);
    const waMessageId = String(flat.messageId || flat.waMessageId || "").trim();
    const isMediaRecovery = flat.mediaRecovery === true;
    // Dedupe DOM+WPP del mismo waMessageId (salvo mediaRecovery real).
    if (waMessageId && !isMediaRecovery && (event.type === "NEW_MESSAGE" || event.type === "MESSAGE_SENT")) {
      const seenKey = `seenMsg:${waMessageId}`;
      const seenStore = await chrome.storage.local.get(seenKey);
      const prev = Number(seenStore[seenKey] || 0);
      const now = Date.now();
      if (prev && now - prev < 90_000) {
        console.log("[ServiceWorker] skip evento duplicado (DOM/WPP)", waMessageId, event.type);
        return;
      }
      await chrome.storage.local.set({ [seenKey]: now });
    }

    let stored = event;
    if (eventHasHeavyMedia(event)) {
      console.log("[MAPLE MULTIMEDIA] Guardando en PC / offload selectivo...");
      stored = await offloadHeavyMediaFromEvent(event);
    }

    const result = await chrome.storage.local.get("eventQueue");
    const queue: any[] = result.eventQueue || [];
    queue.push(stored);
    if (queue.length > 500) queue.splice(0, queue.length - 500);
    await chrome.storage.local.set({ eventQueue: queue });

    if (!CONSTANTS.USE_LEGACY_ALARMS) {
      // Intentar flushing rápido inmediato
      await flushIngestQueue().catch(() => {});
    } else if (eventHasHeavyMedia(event)) {
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
    const ownPics = [
      event.payload.profilePicture,
      event.payload.meProfilePictureUrl,
      ...(Array.isArray(event.payload.meProfilePictureUrls) ? event.payload.meProfilePictureUrls : []),
    ];
    rememberOwnAvatars(ownPics);
    const session: SessionInfo = {
      sessionId: event.payload.sessionId,
      browserId: event.payload.browserId,
      deviceId: event.payload.deviceId,
      phoneNumber: event.payload.phoneNumber,
      profileName: event.payload.profileName,
      profilePicture: ownPics.map((url) => httpProfileUrl(url)).find(Boolean) || event.payload.profilePicture,
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
    case "GET_STATUS":
    case "GET_BRIDGE_HEALTH": {
      const stored = await chrome.storage.local.get([
        "bridgeHealth",
        "eventQueue",
        "lastKeepAlive",
        "wsStatus",
        "lastEngineOkAt",
        "lastSessionOkAt",
        "lastBridgeOkAt",
        "lastLinkOkAt",
        "linkFailStreak",
      ]);
      const health = stored.bridgeHealth || {};
      const q = stored.eventQueue || [];
      const now = Date.now();
      if (Number(stored.lastEngineOkAt) > lastEngineOkAt) lastEngineOkAt = Number(stored.lastEngineOkAt);
      if (Number(stored.lastSessionOkAt) > lastSessionOkAt) lastSessionOkAt = Number(stored.lastSessionOkAt);
      if (Number(stored.lastBridgeOkAt) > lastBridgeOkAt) lastBridgeOkAt = Number(stored.lastBridgeOkAt);
      if (Number(stored.lastLinkOkAt) > lastLinkOkAt) lastLinkOkAt = Number(stored.lastLinkOkAt);
      const healthUpdatedAt = Number(health.updatedAt) || 0;
      const healthFresh = healthUpdatedAt > 0 && now - healthUpdatedAt < 70_000;
      const engineRaw = healthFresh && (!!health.wppReady || !!health.engineReady);
      const sessionRaw = activeSessions.size > 0 || engineRaw;
      const bridgeRaw =
        healthFresh && health.phase === "ok" && health.healthy !== false && engineRaw;
      if (engineRaw) lastEngineOkAt = now;
      if (sessionRaw) lastSessionOkAt = now;
      if (bridgeRaw) lastBridgeOkAt = now;
      const streak = linkFailStreak;
      const view = presentConnection({
        now,
        configured: linkConfigured(),
        failStreak: streak,
        lastLinkOkAt,
        engineRaw,
        sessionRaw,
        bridgeRaw,
        lastEngineOkAt,
        lastSessionOkAt,
        lastBridgeOkAt,
      });
      if (engineRaw || sessionRaw || bridgeRaw) {
        void chrome.storage.local.set({
          lastEngineOkAt,
          lastSessionOkAt,
          lastBridgeOkAt,
        });
      }
      return {
        wppReady: view.wppReady,
        sessionReady: view.sessionReady,
        backendConnected: view.backendConnected,
        uiConnected: view.uiConnected,
        queueSize: Array.isArray(q) ? q.length : 0,
        pollingLatency: 0,
        lastMessage: health.message || null,
        lastCommand: health.lastError || null,
        bridge: health,
        lastKeepAlive: stored.lastKeepAlive || null,
        wsStatus: linkIsUp({
          configured: linkConfigured(),
          failStreak: streak,
          lastOkAt: lastLinkOkAt,
          now,
        })
          ? "connected"
          : stored.wsStatus || "disconnected",
      };
    }
    case "GET_CONFIG":
      return {
        backendUrl: backendUrl || "",
        sessionToken: sessionToken || "",
      };
    case "GET_HISTORY_IMPORT_STATUS":
      return getHistoryImportStatus();
    case "STOP_HISTORY_IMPORT":
      return stopHistoryImport();
    case "START_HISTORY_IMPORT": {
      // Recargar config por si el SW se reinició y perdió memoria
      if (!backendUrl || !sessionToken) {
        await loadConfig();
      }
      if (!backendUrl || !sessionToken) {
        throw new Error("Configura Backend URL y Session Token en la pestaña config");
      }
      const maxChats = Number(message.payload?.maxChats ?? 200);
      const messagesPerChat = Number(message.payload?.messagesPerChat ?? 200);
      const pauseMs = Number(message.payload?.pauseMs ?? 900);
      return await startHistoryImport({
        maxChats,
        messagesPerChat,
        pauseMs,
        backendUrl,
        sessionToken,
        sendWaCommand: sendWaCommandToTab,
      });
    }
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
