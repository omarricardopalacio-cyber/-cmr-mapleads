import { useState, useEffect } from "react";

interface DebugState {
  wppLoaded: boolean;
  engineLoaded: boolean;
  lastEvent: any;
  lastError: string;
  wsStatus: string;
  eventsCount: number;
}

export default function DebugPanel() {
  const [state, setState] = useState<DebugState>({
    wppLoaded: false,
    engineLoaded: false,
    lastEvent: null,
    lastError: "",
    wsStatus: "desconectado",
    eventsCount: 0,
  });
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const check = () => {
      chrome.storage.local.get([
        "wsStatus", "lastError", "lastDomEvent", "lastPoll",
      ]).then((stored) => {
        setState((prev) => ({
          ...prev,
          wsStatus: stored.wsStatus || "desconectado",
          lastError: stored.lastError || "",
          lastEvent: stored.lastDomEvent || prev.lastEvent,
        }));
      });

      // Ping directo al content script (no requiere injected script)
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        const waTab = tabs.find((t) => t.url?.includes("web.whatsapp.com"));
        if (waTab?.id) {
          chrome.tabs.sendMessage(waTab.id, {
            source: "MAPLE_WA_POPUP_PING",
          }).then((res) => {
            setState((prev) => ({
              ...prev,
              engineLoaded: !!res?.contentScript,
              wppLoaded: !!res?.engineReady, // WPP confirmado por eventos del engine
            }));
          }).catch((err) => {
            console.log("[DebugPanel] Ping falló:", err);
            setState((prev) => ({ ...prev, engineLoaded: false, wppLoaded: false }));
          });
        }
      });
    };

    check();
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, []);

  const testSend = () => {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const waTab = tabs.find((t) => t.url?.includes("web.whatsapp.com"));
      if (!waTab?.id) {
        setLogs((l) => [...l.slice(-19), "❌ No hay tab de WhatsApp activa"]);
        return;
      }
      // Ping directo al content script
      chrome.tabs.sendMessage(waTab.id, {
        source: "MAPLE_WA_POPUP_PING",
      }).then((res) => {
        setLogs((l) => [...l.slice(-19), `✅ Content script OK: ${JSON.stringify(res)}`]);
      }).catch((err) => {
        setLogs((l) => [...l.slice(-19), `❌ Error: ${err?.message || err}`]);
      });
    });
  };

  const clearLogs = () => setLogs([]);

  const StatusBadge = ({ ok, label }: { ok: boolean; label: string }) => (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
      ok ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
    }`}>
      {ok ? "OK" : "NO"} {label}
    </span>
  );

  return (
    <div className="space-y-3 text-xs">
      <div className="flex gap-2 flex-wrap">
        <StatusBadge ok={state.wsStatus === "connected"} label="Backend" />
        <StatusBadge ok={state.engineLoaded} label="Engine" />
        <StatusBadge ok={state.wppLoaded} label="WPP" />
      </div>

      <div className="bg-slate-800 rounded p-2 space-y-1">
        <div className="flex justify-between text-slate-400">
          <span>Último evento DOM:</span>
          <span className="text-slate-500">{state.lastEvent ? new Date(state.lastEvent.at).toLocaleTimeString() : "—"}</span>
        </div>
        {state.lastEvent ? (
          <div className="text-emerald-400 font-mono text-[11px] truncate">
            [{state.lastEvent.direction}] {state.lastEvent.text}
          </div>
        ) : (
          <div className="text-slate-500 italic">Ningún mensaje detectado aún</div>
        )}
      </div>

      {state.lastError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded p-2 text-red-400">
          Error: {state.lastError}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={testSend}
          className="flex-1 bg-slate-700 hover:bg-slate-600 text-white rounded py-1 text-[11px]"
        >
          Test Content Script
        </button>
        <button
          onClick={clearLogs}
          className="px-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-[11px]"
        >
          Limpiar
        </button>
      </div>

      <div className="bg-slate-900 rounded p-2 h-32 overflow-y-auto font-mono text-[10px] space-y-0.5">
        {logs.length === 0 && <span className="text-slate-600">Sin logs...</span>}
        {logs.map((log, i) => (
          <div key={i} className={log.startsWith("❌") ? "text-red-400" : log.startsWith("✅") ? "text-emerald-400" : "text-slate-400"}>
            {log}
          </div>
        ))}
      </div>
    </div>
  );
}
