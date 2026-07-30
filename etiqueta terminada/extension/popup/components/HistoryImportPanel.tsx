import { useEffect, useState } from "react";

type HistoryStatus = {
  running: boolean;
  stopped: boolean;
  phase: string;
  totalChats: number;
  processed: number;
  importedMessages: number;
  skippedChats: number;
  errors: number;
  currentChat: string | null;
  lastError: string | null;
};

const empty: HistoryStatus = {
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
};

function sendPopupRequest(event: string, payload: Record<string, unknown> = {}) {
  return new Promise<{ ok?: boolean; payload?: any; error?: string }>((resolve) => {
    try {
      chrome.runtime.sendMessage(
        {
          source: "MAPLE_WA_POPUP",
          channel: "WA_REQUEST",
          event,
          payload: { type: event, ...payload },
        },
        (response) => {
          const err = chrome.runtime.lastError?.message;
          if (err) {
            resolve({ ok: false, error: err });
            return;
          }
          resolve(response || { ok: false, error: "Sin respuesta del service worker" });
        },
      );
    } catch (e: any) {
      resolve({ ok: false, error: e?.message || String(e) });
    }
  });
}

export default function HistoryImportPanel() {
  const [status, setStatus] = useState<HistoryStatus>(empty);
  const [maxChats, setMaxChats] = useState(200);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const refresh = async () => {
    const response = await sendPopupRequest("GET_HISTORY_IMPORT_STATUS");
    if (response?.payload && typeof response.payload.phase === "string") {
      setStatus({ ...empty, ...response.payload });
    }
  };

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const start = async () => {
    setBusy(true);
    setHint(null);
    setStatus((s) => ({ ...s, lastError: null, phase: "listing" }));

    // Pedir permiso de host al CRM (Chrome a veces no aplica host_permissions al actualizar)
    try {
      const cfg = await chrome.storage.local.get(["backendUrl"]);
      const backendUrl = String(cfg.backendUrl || "https://cmrmaleads.netlify.app").replace(/\/$/, "");
      const origin = new URL(backendUrl).origin + "/*";
      const ok = await chrome.permissions.request({ origins: [origin, "https://*/*"] });
      if (!ok) {
        setBusy(false);
        setHint("Debes aceptar el permiso para conectar con el CRM.");
        setStatus((s) => ({
          ...s,
          phase: "error",
          lastError: "Permiso de host denegado",
          running: false,
        }));
        return;
      }
    } catch {
      /* SW / popup: seguimos */
    }

    const response = await sendPopupRequest("START_HISTORY_IMPORT", {
      maxChats,
      messagesPerChat: 200,
      pauseMs: maxChats > 300 ? 400 : 600,
    });

    setBusy(false);

    if (!response?.ok) {
      const err = response?.error || "No se pudo iniciar la importación";
      setHint(err);
      setStatus((s) => ({ ...s, lastError: err, phase: "error", running: false }));
      return;
    }

    if (response.payload && typeof response.payload.phase === "string") {
      setStatus({ ...empty, ...response.payload });
      setHint(
        response.payload.running
          ? "Importación iniciada. Deja WhatsApp Web abierto."
          : null,
      );
    } else {
      setHint("Service worker respondió vacío. Recarga la extensión.");
    }
  };

  const stop = async () => {
    const response = await sendPopupRequest("STOP_HISTORY_IMPORT");
    if (response?.payload) setStatus({ ...empty, ...response.payload });
  };

  const pct =
    status.totalChats > 0
      ? Math.min(100, Math.round((status.processed / status.totalChats) * 100))
      : 0;

  return (
    <div className="space-y-3 text-xs">
      <div className="bg-slate-800 rounded p-3 space-y-2">
        <p className="text-slate-300 leading-relaxed">
          Importa los últimos <b className="text-emerald-400">200 mensajes</b> de cada chat{" "}
          <b className="text-emerald-400">1:1</b> (sin grupos). Hasta{" "}
          <b className="text-emerald-400">1000 chats</b>. El vigilante clasifica con
          intención, etiquetas y segmentos. <b>No envía mensajes</b> ni inicia flujos.
        </p>
        <p className="text-[10px] text-slate-500">
          Requiere WhatsApp Web abierto y Backend/Token en Config. Con ~1000 chats puede
          tardar varios minutos: no cierres la pestaña.
        </p>
        <label className="flex items-center justify-between gap-2 text-slate-400">
          <span>Máx. chats</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={maxChats}
            disabled={status.running || busy}
            onChange={(e) => setMaxChats(Math.min(1000, Math.max(1, Number(e.target.value) || 200)))}
            className="w-20 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-slate-200"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={status.running || busy}
            onClick={() => void start()}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded py-2 font-medium"
          >
            {busy ? "Iniciando…" : status.running ? "Importando…" : "Importar historial"}
          </button>
          <button
            type="button"
            disabled={!status.running}
            onClick={() => void stop()}
            className="px-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded"
          >
            Detener
          </button>
        </div>
        {hint ? <p className="text-emerald-400/90 text-[10px]">{hint}</p> : null}
      </div>

      <div className="bg-slate-800 rounded p-3 space-y-2">
        <div className="flex justify-between text-slate-400">
          <span>Estado</span>
          <span className="text-emerald-400 font-mono">{status.phase}</span>
        </div>
        <div className="h-2 bg-slate-900 rounded overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-y-1 text-slate-300">
          <span className="text-slate-500">Progreso</span>
          <span className="text-right font-mono">
            {status.processed}/{status.totalChats || "—"}
          </span>
          <span className="text-slate-500">Msgs importados</span>
          <span className="text-right font-mono text-emerald-400">{status.importedMessages}</span>
          <span className="text-slate-500">Omitidos / errores</span>
          <span className="text-right font-mono">
            {status.skippedChats} / {status.errors}
          </span>
          <span className="text-slate-500">Chat actual</span>
          <span className="text-right truncate">{status.currentChat || "—"}</span>
        </div>
        {status.lastError ? (
          <p className="text-amber-400/90 text-[10px] break-words">Último error: {status.lastError}</p>
        ) : null}
      </div>
    </div>
  );
}
