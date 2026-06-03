/**
 * MAPLEADS → Backend sync.
 * Lee backendUrl + token desde chrome.storage.local y envía leads por lotes.
 */
(() => {
  const KEY = { backend: "mls_backend_url", token: "mls_backend_token", buffer: "mls_buffer" };

  async function getConfig() {
    const s = await chrome.storage.local.get([KEY.backend, KEY.token]);
    return { url: (s[KEY.backend] || "").replace(/\/$/, ""), token: s[KEY.token] || "" };
  }

  async function setConfig(url, token) {
    await chrome.storage.local.set({ [KEY.backend]: url || "", [KEY.token]: token || "" });
  }

  async function sendBatch(leads) {
    const { url, token } = await getConfig();
    if (!url || !token) {
      console.warn("[mapleads sync] backend no configurado");
      return { skipped: true };
    }
    try {
      const res = await fetch(`${url}/api/public/mapleads/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Mapleads-Token": token,
        },
        body: JSON.stringify({ leads }),
      });
      if (!res.ok) {
        console.error("[mapleads sync] HTTP", res.status, await res.text());
        return { error: `HTTP ${res.status}` };
      }
      const j = await res.json();
      console.log("[mapleads sync] ok", j);
      return j;
    } catch (e) {
      console.error("[mapleads sync] fail", e);
      return { error: String(e?.message || e) };
    }
  }

  globalThis.MLBackendSync = { getConfig, setConfig, sendBatch };
})();
