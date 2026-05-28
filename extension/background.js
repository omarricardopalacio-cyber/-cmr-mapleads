// Background service worker (MV3) — HTTP long-poll bridge a Lovable Cloud
// El runtime serverless no soporta WebSocket persistente; usamos POST /ingest + GET /commands.

const POLL_MS = 3000;
const FLUSH_MS = 1500;
const MAX_BATCH = 25;

let backendUrl = null;
let sessionToken = null;
let pollTimer = null;
let flushTimer = null;
const outbox = []; // eventos pendientes hacia backend

async function loadConfig() {
  const cfg = await chrome.storage.local.get(["backendUrl", "sessionToken"]);
  backendUrl = (cfg.backendUrl || "").replace(/\/$/, "") || null;
  sessionToken = cfg.sessionToken || null;
}

function configured() {
  return !!backendUrl && !!sessionToken;
}

async function flushOutbox() {
  if (!configured() || outbox.length === 0) return;
  const batch = outbox.splice(0, MAX_BATCH);
  try {
    const res = await fetch(`${backendUrl}/api/public/engine/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": sessionToken },
      body: JSON.stringify({ events: batch }),
    });
    if (!res.ok) {
      console.warn("[engine] ingest fallo", res.status);
      // reencolar al frente
      outbox.unshift(...batch);
    } else {
      chrome.storage.local.set({ wsStatus: "connected", lastFlush: Date.now() });
    }
  } catch (e) {
    console.warn("[engine] ingest network err", e);
    outbox.unshift(...batch);
    chrome.storage.local.set({ wsStatus: "disconnected" });
  }
}

async function pollCommands() {
  if (!configured()) return;
  try {
    const res = await fetch(`${backendUrl}/api/public/engine/commands`, {
      method: "GET",
      headers: { "X-Session-Token": sessionToken },
    });
    if (!res.ok) return;
    const { commands = [] } = await res.json();
    for (const cmd of commands) {
      await dispatchCommand(cmd);
    }
  } catch (e) {
    console.warn("[engine] poll err", e);
  }
}

async function dispatchCommand(cmd) {
  // cmd: { id, type, payload }
  if (cmd.type === "send_message") {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    if (!tabs.length) {
      enqueue({ type: "ack", commandId: cmd.id, ackStatus: "no_whatsapp_tab" });
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, {
      __engine: true,
      type: "SEND_MESSAGE",
      commandId: cmd.id,
      payload: cmd.payload,
    });
  }
}

function enqueue(evt) {
  outbox.push(evt);
  if (outbox.length >= MAX_BATCH) flushOutbox();
}

function startLoops() {
  if (pollTimer) clearInterval(pollTimer);
  if (flushTimer) clearInterval(flushTimer);
  pollTimer = setInterval(pollCommands, POLL_MS);
  flushTimer = setInterval(flushOutbox, FLUSH_MS);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.__engine && msg.payload) {
    enqueue(msg.payload);
    sendResponse({ ok: true });
  }
  return true;
});

chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.backendUrl || changes.sessionToken) {
    await loadConfig();
    startLoops();
  }
});

(async () => {
  await loadConfig();
  startLoops();
  // heartbeat inmediato
  enqueue({ type: "heartbeat" });
})();
