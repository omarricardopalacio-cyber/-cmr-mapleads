import { useEffect, useState, useCallback } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SupportWidgetProps {
  requestId: string;
  threadId: string;
  minutesRemaining?: number;
}

export function SupportWidget({ requestId, threadId, minutesRemaining = 3 }: SupportWidgetProps) {
  const [timeLeft, setTimeLeft] = useState(minutesRemaining * 60); // segundos
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleContactSupport = useCallback(async () => {
    setIsConnecting(true);
    try {
      // Emit event para el backend
      window.dispatchEvent(
        new CustomEvent("support-requested", {
          detail: { requestId, threadId },
        })
      );

      // Toast o notificación
      console.log("[SupportWidget] Support requested:", { requestId, threadId });
    } finally {
      setIsConnecting(false);
    }
  }, [requestId, threadId]);

  const formatMinutesSeconds = (secs: number) => {
    const mins = Math.floor(secs / 60);
    if (mins > 0) return `${mins}m ${secs % 60}s`;
    return `${secs}s`;
  };

  return (
    <div className="max-w-[70%] rounded-lg px-4 py-3 shadow-sm mr-auto bg-linear-to-r from-orange-500 to-orange-600 text-white border border-orange-400">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <div className="font-medium text-sm">¿Necesitas ayuda?</div>
          <div className="text-xs opacity-95">
            Nuestro equipo de soporte está siendo notificado. Intentaremos responder en{" "}
            <span className="font-mono font-semibold">{formatTime(timeLeft)}</span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="w-full mt-2 text-orange-600 hover:bg-white/90"
            onClick={handleContactSupport}
            disabled={isConnecting || timeLeft === 0}
          >
            {isConnecting && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            {timeLeft === 0 ? "Soporte ha respondido" : "Conectar con asesor"}
          </Button>
          <div className="text-[10px] opacity-75">
            El asesora revisará tu caso en los próximos minutos
          </div>
        </div>
      </div>
    </div>
  );
}

export default SupportWidget;
