import { useEffect, useState } from "react";
import StatusPanel from "./components/StatusPanel";
import ConfigPanel from "./components/ConfigPanel";
import SessionList from "./components/SessionList";
import QueueStatus from "./components/QueueStatus";
import DebugPanel from "./components/DebugPanel";
import MediaBackupPanel from "./components/MediaBackupPanel";
import HistoryImportPanel from "./components/HistoryImportPanel";

export type PopupStatus = {
  wppReady: boolean;
  sessionReady: boolean;
  lastMessage: string | null;
  lastCommand: string | null;
  queueSize: number;
  backendConnected: boolean;
  uiConnected?: boolean;
  pollingLatency: number;
  bridge?: {
    healthy?: boolean;
    phase?: string;
    message?: string;
    lastError?: string | null;
    lastHealAt?: number | null;
    healCount?: number;
    lastEventAt?: number | null;
    updatedAt?: number;
  };
};

function App() {
  const [tab, setTab] = useState<
    "status" | "config" | "sessions" | "queue" | "media" | "historial" | "debug"
  >("status");
  const [status, setStatus] = useState<PopupStatus | null>(null);

  useEffect(() => {
    const pull = () => {
      chrome.runtime.sendMessage(
        {
          source: "MAPLE_WA_POPUP",
          channel: "WA_REQUEST",
          event: "GET_STATUS",
          payload: { type: "GET_STATUS" },
        },
        (response) => {
          if (chrome.runtime.lastError) return;
          const payload = response?.payload ?? response;
          if (!payload || typeof payload !== "object" || typeof payload.wppReady !== "boolean") return;
          setStatus((prev) => ({ ...(prev || {}), ...payload }));
        },
      );
    };
    pull();
    const interval = setInterval(pull, 2000);
    return () => clearInterval(interval);
  }, []);

  const connected = status?.uiConnected === true;

  const tabs = ["status", "config", "sessions", "queue", "media", "historial", "debug"] as const;

  return (
    <div className="p-4">
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-emerald-400">MAPLE WA Engine</h1>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
              !status
                ? "bg-slate-500/20 text-slate-300 border border-slate-500/30"
                : connected
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-red-500/20 text-red-400 border border-red-500/30"
            }`}
          >
            {!status ? "…" : connected ? "Conectado" : "Desconectado"}
          </span>
        </div>
        <p className="text-xs text-slate-400">WhatsApp Bridge for Cloud CRM</p>
      </header>

      <nav className="flex gap-2 mb-4 text-xs flex-wrap">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 rounded capitalize ${
              tab === t
                ? "bg-emerald-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            {t === "media" ? "media ZIP" : t}
          </button>
        ))}
      </nav>

      <main>
        {tab === "status" && <StatusPanel status={status} />}
        {tab === "config" && <ConfigPanel />}
        {tab === "sessions" && <SessionList />}
        {tab === "queue" && <QueueStatus />}
        {tab === "media" && <MediaBackupPanel />}
        {tab === "historial" && <HistoryImportPanel />}
        {tab === "debug" && <DebugPanel />}
      </main>
    </div>
  );
}

export default App;
