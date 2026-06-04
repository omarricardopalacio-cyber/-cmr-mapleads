import { useEffect, useState } from "react";

export default function QueueStatus() {
  const [queueSize, setQueueSize] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      chrome.runtime.sendMessage(
        { source: "MAPLE_WA_CONTENT", channel: "WA_REQUEST", payload: { type: "GET_QUEUE_SIZE" } },
        (response) => {
          if (typeof response?.payload?.queueSize === "number") {
            setQueueSize(response.payload.queueSize);
          }
        }
      );
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-slate-800 rounded p-4 text-center">
      <div className="text-3xl font-bold text-emerald-400 font-mono">{queueSize}</div>
      <div className="text-xs text-slate-400 mt-1">eventos en cola</div>
      <div className="text-[10px] text-slate-600 mt-2">
        Se sincronizan automáticamente con el backend
      </div>
    </div>
  );
}
