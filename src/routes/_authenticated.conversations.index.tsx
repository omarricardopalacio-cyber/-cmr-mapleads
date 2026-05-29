import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/conversations/")({
  component: EmptyChat,
});

function EmptyChat() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
      <MessageCircle className="h-16 w-16 mb-4 opacity-30" />
      <h2 className="text-lg font-medium mb-1">Selecciona una conversación</h2>
      <p className="text-sm max-w-xs">
        Elige un chat de la lista o pulsa + para iniciar uno nuevo. Los mensajes
        entrantes aparecerán aquí en tiempo real.
      </p>
    </div>
  );
}
