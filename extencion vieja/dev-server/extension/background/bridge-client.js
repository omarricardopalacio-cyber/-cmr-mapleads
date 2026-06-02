// background/bridge-client.js — Cliente HTTP hacia el backend (ingest / commands).
(function () {
  const { MAX_BATCH } = self.__engineConst;
  let backendUrl = null;
  let sessionToken = null;
  const outbox = [];

  async function loadConfig() {
    const cfg = await chrome.storage.local.get(["backendUrl", "sessionToken"]);
    backendUrl = (cfg.backendUrl || "").replace(/\/$/, "") || null;
    sessionToken = cfg.sessionToken || null;
  }

  const configured = () => !!backendUrl && !!sessionToken;

  function enqueue(evt) {
    outbox.push(evt);
    if (outbox.length >= MAX_BATCH) flush();
  }

  async function flush() {
    if (!configured() || outbox.length === 0) return;
    const batch = outbox.splice(0, MAX_BATCH);
    try {
      const res = await fetch(`${backendUrl}/api/public/engine/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Session-Token": sessionToken },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) {
        outbox.unshift(...batch);
        chrome.storage.local.set({ lastError: `ingest ${res.status}` });
      } else {
        chrome.storage.local.set({ wsStatus: "connected", lastFlush: Date.now() });
      }
    } catch (e) {
      outbox.unshift(...batch);
      chrome.storage.local.set({ wsStatus: "disconnected", lastError: String(e?.message || e) });
    }
  }

  async function poll() {
    if (!configured()) {
      chrome.storage.local.set({ wsStatus: "disconnected", lastError: "not_configured" });
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/public/engine/commands`, {
        method: "GET",
        headers: { "X-Session-Token": sessionToken },
      });
      if (!res.ok) {
        chrome.storage.local.set({ wsStatus: "disconnected", lastError: `commands ${res.status}` });
        return;
      }
      chrome.storage.local.set({ wsStatus: "connected", lastPoll: Date.now(), lastError: null });
      const { commands = [] } = await res.json();
      for (const cmd of commands) {
        await self.__engineDispatcher.dispatch(cmd);
      }
    } catch (e) {
      chrome.storage.local.set({ wsStatus: "disconnected", lastError: String(e?.message || e) });
    }
  }

  self.__engineBridge = { loadConfig, enqueue, flush, poll };
})();
