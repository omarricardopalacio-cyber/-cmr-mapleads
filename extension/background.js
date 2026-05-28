// Background service worker (MV3)
// Maneja el WebSocket persistente al backend y enruta eventos entre content script y backend.

const HEARTBEAT_MS = 15000;
let socket = null;
let backendUrl = null;
let sessionToken = null;
let heartbeatTimer = null;
let reconnectAttempts = 0;
const pendingAcks = new Map(); // commandId -> {resolve, timer}

async function loadConfig() {
  const cfg = await chrome.storage.local.get(["backendUrl", "sessionToken"]);
  backendUrl = cfg.backendUrl || null;
  sessionToken = cfg.sessionToken || null;
}

function scheduleReconnect() {
  const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts++));
  setTimeout(connect, delay);
}

async function connect() {
  await loadConfig();
  if (!backendUrl || !sessionToken) {
    console.log("[engine] sin config, esperando popup");
    return;
  }
  try {
    const url = `${backendUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(sessionToken)}`;
    socket = new WebSocket(url);
    socket.onopen = () => {
      reconnectAttempts = 0;
      console.log("[engine] WS conectado");
      heartbeatTimer = setInterval(() => {
        if (socket?.readyState === 1) socket.send(JSON.stringify({ type: "HEARTBEAT", ts: Date.now() }));
      }, HEARTBEAT_MS);
      chrome.storage.local.set({ wsStatus: "connected" });
    };
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleBackendMessage(msg);
      } catch (e) {
        console.error("[engine] mensaje inválido", e);
      }
    };
    socket.onclose = () => {
      clearInterval(heartbeatTimer);
      chrome.storage.local.set({ wsStatus: "disconnected" });
      scheduleReconnect();
    };
    socket.onerror = (e) => console.error("[engine] WS error", e);
  } catch (e) {
    console.error("[engine] connect fail", e);
    scheduleReconnect();
  }
}

function handleBackendMessage(msg) {
  // Comandos del backend hacia el content script (ej: SEND_MESSAGE)
  if (msg.type === "SEND_MESSAGE") {
    forwardToTab(msg);
  } else if (msg.type === "PING") {
    socket?.send(JSON.stringify({ type: "PONG", ts: Date.now() }));
  }
}

async function forwardToTab(msg) {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (!tabs.length) {
    sendToBackend({ type: "COMMAND_ACK", commandId: msg.commandId, ok: false, error: "NO_WHATSAPP_TAB" });
    return;
  }
  chrome.tabs.sendMessage(tabs[0].id, msg);
}

function sendToBackend(payload) {
  if (socket?.readyState === 1) {
    socket.send(JSON.stringify(payload));
  } else {
    // TODO: cola persistente con chrome.storage para reintento
    console.warn("[engine] WS no listo, descartando", payload.type);
  }
}

// Recibir eventos desde el content script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.__engine) {
    sendToBackend(msg.payload);
    sendResponse({ ok: true });
  }
  return true;
});

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.backendUrl || changes.sessionToken) {
    try { socket?.close(); } catch {}
    connect();
  }
});

connect();
