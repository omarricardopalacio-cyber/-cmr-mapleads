import { useEffect, useState } from "react";

interface Status {
  wppReady: boolean;
  sessionReady: boolean;
  lastMessage: string | null;
  lastCommand: string | null;
  queueSize: number;
  backendConnected: boolean;
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
}

function ago(ts?: number | null): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
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
    const pull = () => {
      chrome.runtime.sendMessage(
        {
          source: "MAPLE_WA_POPUP",
          channel: "WA_REQUEST",
          event: "GET_STATUS",
          payload: { type: "GET_STATUS" },
        },
        (response) => {
          const payload = response?.payload ?? response;
          if (payload && typeof payload === "object") {
            setStatus((prev) => ({ ...prev, ...payload }));
          }
        },
      );
    };
    pull();
    const interval = setInterval(pull, 2000);
    return () => clearInterval(interval);
  }, []);

  const phase = status.bridge?.phase || (status.wppReady ? "ok" : "degraded");
  const phaseColor =
    phase === "ok"
      ? "text-emerald-400"
      : phase === "healing"
        ? "text-amber-300"
        : phase === "critical"
          ? "text-red-400"
          : "text-amber-400";

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
            <div
              className={`w-3 h-3 rounded-full mx-auto mb-1 ${ind.ready ? "bg-emerald-400" : "bg-red-400"}`}
            />
            <div className="text-[10px] text-slate-300">{ind.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-slate-800 rounded p-3 text-xs space-y-2 border border-slate-700">
        <div className="flex items-center justify-between">
          <span className="text-slate-200 font-medium">Vigilante Bridge</span>
          <span className={`font-mono uppercase ${phaseColor}`}>{phase}</span>
        </div>
        <p className="text-slate-400 leading-relaxed">
          {status.bridge?.message ||
            status.lastMessage ||
            "Health-check cada 45s. Si no entran/salen mensajes, reinyecta el engine solo."}
        </p>
        <div className="grid grid-cols-2 gap-y-1 text-slate-300">
          <span className="text-slate-500">Último evento</span>
          <span className="text-right font-mono">{ago(status.bridge?.lastEventAt)}</span>
          <span className="text-slate-500">Auto-reparaciones</span>
          <span className="text-right font-mono">{status.bridge?.healCount ?? 0}</span>
          <span className="text-slate-500">Última reparación</span>
          <span className="text-right font-mono">{ago(status.bridge?.lastHealAt)}</span>
        </div>
        {status.bridge?.lastError || status.lastCommand ? (
          <p className="text-amber-400/90 text-[10px] break-words">
            {status.bridge?.lastError || status.lastCommand}
          </p>
        ) : null}
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
      </div>
    </div>
  );
}
