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

export default function HistoryImportPanel() {
  const [status, setStatus] = useState<HistoryStatus>(empty);
  const [maxChats, setMaxChats] = useState(50);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    chrome.runtime.sendMessage(
      {
        source: "MAPLE_WA_CONTENT",
        channel: "WA_REQUEST",
        event: "GET_HISTORY_IMPORT_STATUS",
        payload: { type: "GET_HISTORY_IMPORT_STATUS" },
      },
      (response) => {
        if (response?.payload) setStatus({ ...empty, ...response.payload });
      },
    );
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, []);

  const start = () => {
    setBusy(true);
    chrome.runtime.sendMessage(
      {
        source: "MAPLE_WA_CONTENT",
        channel: "WA_REQUEST",
        event: "START_HISTORY_IMPORT",
        payload: {
          type: "START_HISTORY_IMPORT",
          maxChats,
          messagesPerChat: 50,
        },
      },
      (response) => {
        setBusy(false);
        if (response?.payload) setStatus({ ...empty, ...response.payload });
        if (response?.error) {
          setStatus((s) => ({ ...s, lastError: response.error, phase: "error" }));
        }
      },
    );
  };

  const stop = () => {
    chrome.runtime.sendMessage(
      {
        source: "MAPLE_WA_CONTENT",
        channel: "WA_REQUEST",
        event: "STOP_HISTORY_IMPORT",
        payload: { type: "STOP_HISTORY_IMPORT" },
      },
      (response) => {
        if (response?.payload) setStatus({ ...empty, ...response.payload });
      },
    );
  };

  const pct =
    status.totalChats > 0
      ? Math.min(100, Math.round((status.processed / status.totalChats) * 100))
      : 0;

  return (
    <div className="space-y-3 text-xs">
      <div className="bg-slate-800 rounded p-3 space-y-2">
        <p className="text-slate-300 leading-relaxed">
          Importa los últimos <b className="text-emerald-400">50 mensajes</b> de cada chat{" "}
          <b className="text-emerald-400">1:1</b> (sin grupos). El vigilante clasifica con
          intención, etiquetas y segmentos. <b>No envía mensajes</b> ni inicia flujos.
        </p>
        <label className="flex items-center justify-between gap-2 text-slate-400">
          <span>Máx. chats</span>
          <input
            type="number"
            min={1}
            max={200}
            value={maxChats}
            disabled={status.running}
            onChange={(e) => setMaxChats(Number(e.target.value) || 50)}
            className="w-20 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-slate-200"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={status.running || busy}
            onClick={start}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded py-2 font-medium"
          >
            {status.running ? "Importando…" : "Importar historial"}
          </button>
          <button
            type="button"
            disabled={!status.running}
            onClick={stop}
            className="px-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded"
          >
            Detener
          </button>
        </div>
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
