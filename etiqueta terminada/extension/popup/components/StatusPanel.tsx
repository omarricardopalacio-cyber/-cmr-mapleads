import type { PopupStatus } from "../App";

type Status = PopupStatus;

function ago(ts?: number | null): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export default function StatusPanel({ status }: { status: Status | null }) {
  const view: Status = status || {
    wppReady: false,
    sessionReady: false,
    lastMessage: null,
    lastCommand: null,
    queueSize: 0,
    backendConnected: false,
    pollingLatency: 0,
  };

  const pending = !status;
  const phase = view.bridge?.phase || (pending ? "…" : view.wppReady ? "ok" : "degraded");
  const phaseColor =
    phase === "ok"
      ? "text-emerald-400"
      : phase === "healing"
        ? "text-amber-300"
        : phase === "critical"
          ? "text-red-400"
          : "text-amber-400";

  const indicators = [
    { label: "WPP Engine", ready: view.wppReady },
    { label: "Session", ready: view.sessionReady },
    { label: "Backend", ready: view.backendConnected },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {indicators.map((ind) => (
          <div key={ind.label} className="bg-slate-800 rounded p-2 text-center">
            <div
              className={`w-3 h-3 rounded-full mx-auto mb-1 ${
                pending ? "bg-slate-500" : ind.ready ? "bg-emerald-400" : "bg-red-400"
              }`}
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
          {view.bridge?.message ||
            view.lastMessage ||
            "Health-check cada 45s. Si no entran/salen mensajes, reinyecta el engine solo."}
        </p>
        <div className="grid grid-cols-2 gap-y-1 text-slate-300">
          <span className="text-slate-500">Último evento</span>
          <span className="text-right font-mono">{ago(view.bridge?.lastEventAt)}</span>
          <span className="text-slate-500">Auto-reparaciones</span>
          <span className="text-right font-mono">{view.bridge?.healCount ?? 0}</span>
          <span className="text-slate-500">Última reparación</span>
          <span className="text-right font-mono">{ago(view.bridge?.lastHealAt)}</span>
        </div>
        {view.bridge?.lastError || view.lastCommand ? (
          <p className="text-amber-400/90 text-[10px] break-words">
            {view.bridge?.lastError || view.lastCommand}
          </p>
        ) : null}
      </div>

      <div className="bg-slate-800 rounded p-3 text-xs space-y-2">
        <div className="flex justify-between">
          <span className="text-slate-400">Queue</span>
          <span className="text-emerald-400 font-mono">{view.queueSize}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Latency</span>
          <span className="text-emerald-400 font-mono">{view.pollingLatency}ms</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Last Msg</span>
          <span className="text-slate-300 truncate max-w-[140px]">{view.lastMessage || "-"}</span>
        </div>
      </div>
    </div>
  );
}
