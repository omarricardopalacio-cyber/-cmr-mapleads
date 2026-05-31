import { useEffect, useState } from "react";
import StatusPanel from "./components/StatusPanel";
import ConfigPanel from "./components/ConfigPanel";
import SessionList from "./components/SessionList";
import QueueStatus from "./components/QueueStatus";
import DebugPanel from "./components/DebugPanel";

function App() {
  const [tab, setTab] = useState<"status" | "config" | "sessions" | "queue" | "debug">("status");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const check = () => {
      chrome.storage.local.get(["wsStatus"]).then((stored) => {
        setConnected(stored.wsStatus === "connected");
      });
    };
    check();
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4">
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-emerald-400">MAPLE WA Engine</h1>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
              connected
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-red-500/20 text-red-400 border border-red-500/30"
            }`}
          >
            {connected ? "Conectado" : "Desconectado"}
          </span>
        </div>
        <p className="text-xs text-slate-400">WhatsApp Bridge for Cloud CRM</p>
      </header>

      <nav className="flex gap-2 mb-4 text-xs flex-wrap">
        {(["status", "config", "sessions", "queue", "debug"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 rounded capitalize ${
              tab === t
                ? "bg-emerald-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <main>
        {tab === "status" && <StatusPanel />}
        {tab === "config" && <ConfigPanel />}
        {tab === "sessions" && <SessionList />}
        {tab === "queue" && <QueueStatus />}
        {tab === "debug" && <DebugPanel />}
      </main>
    </div>
  );
}

export default App;
