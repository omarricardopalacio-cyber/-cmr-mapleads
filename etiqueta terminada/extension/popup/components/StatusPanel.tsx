import { useEffect, useState } from "react";

interface Status {
  wppReady: boolean;
  sessionReady: boolean;
  lastMessage: string | null;
  lastCommand: string | null;
  queueSize: number;
  backendConnected: boolean;
  pollingLatency: number;
}

export default function StatusPanel() {
  const [status, setStatus] = useState<Status>({
    wppReady: false,
    sessionReady: false,
    lastMessage: null,
    lastCommand: null,
    queueSize: 0,
    backendConnected: false,
    pollingLatency: 0,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      chrome.runtime.sendMessage(
        { source: "MAPLE_WA_CONTENT", channel: "WA_REQUEST", payload: { type: "GET_STATUS" } },
        (response) => {
          if (response?.payload) {
            setStatus((prev) => ({ ...prev, ...response.payload }));
          }
        }
      );
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const indicators = [
    { label: "WPP Engine", ready: status.wppReady },
    { label: "Session", ready: status.sessionReady },
    { label: "Backend", ready: status.backendConnected },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {indicators.map((ind) => (
          <div key={ind.label} className="bg-slate-800 rounded p-2 text-center">
            <div className={`w-3 h-3 rounded-full mx-auto mb-1 ${ind.ready ? "bg-emerald-400" : "bg-red-400"}`} />
            <div className="text-[10px] text-slate-300">{ind.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-slate-800 rounded p-3 text-xs space-y-2">
        <div className="flex justify-between">
          <span className="text-slate-400">Queue</span>
          <span className="text-emerald-400 font-mono">{status.queueSize}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Latency</span>
          <span className="text-emerald-400 font-mono">{status.pollingLatency}ms</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Last Msg</span>
          <span className="text-slate-300 truncate max-w-[140px]">{status.lastMessage || "-"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Last Cmd</span>
          <span className="text-slate-300 truncate max-w-[140px]">{status.lastCommand || "-"}</span>
        </div>
      </div>
    </div>
  );
}
