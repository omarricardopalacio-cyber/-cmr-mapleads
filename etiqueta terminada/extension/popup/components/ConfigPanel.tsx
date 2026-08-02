import { useState, useEffect } from "react";

declare const __MAPLE_DESKTOP_PILOT__: boolean;

const STORAGE_KEYS = ["backendUrl", "sessionToken"] as const;
const PRODUCTION_BACKEND = "https://cmrmaleads.netlify.app";
// Vite replaces this identifier at build time; keep a runtime fallback for safety.
const DESKTOP_PILOT =
  typeof __MAPLE_DESKTOP_PILOT__ !== "undefined" ? __MAPLE_DESKTOP_PILOT__ : false;
const DEFAULT_BACKEND = DESKTOP_PILOT ? "http://127.0.0.1:4317" : PRODUCTION_BACKEND;
const LEGACY_BACKENDS = new Set([
  "https://project--289483ef-62cc-4bc6-91f6-2ef8e90b8d34.lovable.app",
]);

export default function ConfigPanel() {
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND);
  const [sessionToken, setSessionToken] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEYS).then((stored) => {
      const storedUrl =
        typeof stored.backendUrl === "string"
          ? stored.backendUrl.trim().replace(/\/$/, "")
          : "";
      const backend =
        !storedUrl || LEGACY_BACKENDS.has(storedUrl)
          ? DEFAULT_BACKEND
          : storedUrl;
      setBackendUrl(backend);
      // No escribir storage aquí: pisar solo la URL sin token dispara not_configured.
      const token =
        typeof stored.sessionToken === "string" ? stored.sessionToken.trim() : "";
      setSessionToken(token);
      setConfigured(Boolean(backend && token));
    });
  }, []);

  const save = async () => {
    setError("");
    const cleanUrl = backendUrl.trim().replace(/\/$/, "");
    const token = sessionToken.trim();
    if (!cleanUrl) {
      setError("Falta Backend URL");
      return;
    }
    if (!token || token.length < 16) {
      setError(
        "Pega el Session Token de Sesiones WhatsApp (CRM) y pulsa Guardar. Sin token → Error: not_configured",
      );
      return;
    }

    await chrome.storage.local.set({
      backendUrl: cleanUrl,
      sessionToken: token,
      lastError: null,
    });

    try {
      await chrome.runtime.sendMessage({
        source: "MAPLE_WA_POPUP",
        channel: "CONFIG",
        payload: { backendUrl: cleanUrl, sessionToken: token },
      });
    } catch {
      // SW dormido: storage.onChanged lo despertará
    }

    setConfigured(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-400 leading-relaxed">
        1) Copia URL + Token desde el CRM (Sesiones). 2) Guarda aquí. 3) Abre{" "}
        <span className="text-emerald-400">web.whatsapp.com</span> y recarga esa pestaña.
      </p>
      <div
        className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
          configured
            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
            : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
        }`}
      >
        {configured ? "Config en storage: OK" : "Config incompleta (falta token guardado)"}
      </div>
      <div>
        <label className="block text-slate-400 mb-1">Backend URL</label>
        <input
          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-emerald-500"
          value={backendUrl}
          onChange={(e) => setBackendUrl(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div>
        <label className="block text-slate-400 mb-1">Session Token</label>
        <input
          type="text"
          spellCheck={false}
          autoComplete="off"
          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono text-[11px]"
          value={sessionToken}
          onChange={(e) => setSessionToken(e.target.value)}
          placeholder="Pega el token del CRM aquí"
        />
      </div>
      {error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-2 text-red-400">
          {error}
        </div>
      ) : null}
      <button
        onClick={save}
        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded py-1.5 font-medium transition"
      >
        {saved ? "Guardado!" : "Guardar Configuración"}
      </button>
    </div>
  );
}
