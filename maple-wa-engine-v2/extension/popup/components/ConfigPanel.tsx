import { useState, useEffect } from "react";

const STORAGE_KEYS = ["backendUrl", "sessionToken"] as const;

export default function ConfigPanel() {
  const [backendUrl, setBackendUrl] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS).then((stored) => {
      if (stored.backendUrl) setBackendUrl(stored.backendUrl);
      if (typeof stored.sessionToken === "string") setSessionToken(stored.sessionToken);
    });
  }, []);

  const save = async () => {
    const cleanUrl = backendUrl.trim().replace(/\/$/, "");
    await chrome.storage.local.set({
      backendUrl: cleanUrl,
      sessionToken: sessionToken.trim(),
    });

    // Notificar al service worker
    try {
      await chrome.runtime.sendMessage({
        source: "MAPLE_WA_CONTENT",
        channel: "CONFIG",
        payload: { backendUrl: cleanUrl, sessionToken: sessionToken.trim() },
      });
    } catch {
      // SW dormido
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-3 text-xs">
      <div>
        <label className="block text-slate-400 mb-1">Backend URL</label>
        <input
          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-emerald-500"
          value={backendUrl}
          onChange={(e) => setBackendUrl(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-slate-400 mb-1">Session Token</label>
        <input
          type="password"
          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-emerald-500"
          value={sessionToken}
          onChange={(e) => setSessionToken(e.target.value)}
        />
      </div>
      <button
        onClick={save}
        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded py-1.5 font-medium transition"
      >
        {saved ? "Guardado!" : "Guardar Configuración"}
      </button>
    </div>
  );
}
