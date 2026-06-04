import { useEffect, useState } from "react";

interface Session {
  sessionId: string;
  deviceId: string;
  profileName?: string;
  phoneNumber?: string;
  isReady: boolean;
  connectedAt: number;
}

export default function SessionList() {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    chrome.runtime.sendMessage(
      { source: "MAPLE_WA_CONTENT", channel: "WA_REQUEST", payload: { type: "GET_SESSIONS" } },
      (response) => {
        if (Array.isArray(response?.payload)) {
          setSessions(response.payload);
        }
      }
    );
  }, []);

  if (sessions.length === 0) {
    return <div className="text-xs text-slate-400 text-center py-4">No hay sesiones activas</div>;
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => (
        <div key={s.sessionId} className="bg-slate-800 rounded p-2 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-slate-200 font-medium">{s.profileName || s.deviceId}</span>
            <span className={`w-2 h-2 rounded-full ${s.isReady ? "bg-emerald-400" : "bg-red-400"}`} />
          </div>
          <div className="text-slate-500 mt-1">{s.phoneNumber || s.sessionId.slice(0, 20)}...</div>
          <div className="text-slate-600 mt-0.5">
            {new Date(s.connectedAt).toLocaleTimeString()}
          </div>
        </div>
      ))}
    </div>
  );
}
