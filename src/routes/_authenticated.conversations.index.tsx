import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { listSessions } from "@/lib/sessions.functions";
import { sendDirectMessage } from "@/lib/messaging.functions";

export const Route = createFileRoute("/_authenticated/conversations/")({
  component: StartChatPanel,
});

function StartChatPanel() {
  const sessionsFn = useServerFn(listSessions);
  const sendFn = useServerFn(sendDirectMessage);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["sessions"], queryFn: () => sessionsFn({}) });
  const sessions = data?.sessions ?? [];
  const connected = sessions.filter((s) => s.status === "connected");

  const [sessionId, setSessionId] = useState("");
  const [chatId, setChatId] = useState("");
  const [text, setText] = useState("¡Hola! Mensaje de prueba desde el CRM.");

  const mut = useMutation({
    mutationFn: (vars: { sessionId: string; chatId: string; text: string }) =>
      sendFn({ data: vars }),
    onSuccess: () => {
      toast.success("Mensaje encolado. La extensión lo enviará en ~5s.");
      qc.invalidateQueries({ queryKey: ["threads"] });
      setText("¡Hola! Mensaje de prueba desde el CRM.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sid = sessionId || connected[0]?.id || sessions[0]?.id;
    if (!sid) return toast.error("No hay sesiones. Conecta la extensión en /sessions.");
    if (!chatId.trim()) return toast.error("Falta el número (ej: 521234567890)");
    if (!text.trim()) return toast.error("Falta el mensaje");
    mut.mutate({ sessionId: sid, chatId: chatId.trim(), text: text.trim() });
  };

  return (
    <div className="h-full overflow-y-auto p-6 flex flex-col items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            <CardTitle>Iniciar conversación</CardTitle>
          </div>
          <CardDescription>
            Envía un mensaje de prueba a un número de WhatsApp. Si el contacto
            responde, aparecerá en la lista de la izquierda en tiempo real.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Sesión</label>
              <select
                className="w-full bg-background border rounded-md px-3 py-2 text-sm"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
              >
                <option value="">
                  {sessions.length === 0
                    ? "Sin sesiones — conecta la extensión"
                    : `Auto (${connected[0]?.label || sessions[0]?.label})`}
                </option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} — {s.status}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Número con código país
              </label>
              <Input
                placeholder="521234567890"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                inputMode="numeric"
              />
              <p className="text-[10px] text-muted-foreground">
                Sin "+", sin espacios. Se le agrega @c.us automáticamente.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Mensaje</label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
              />
            </div>
            <Button type="submit" className="w-full" disabled={mut.isPending}>
              <Send className="h-4 w-4 mr-2" />
              {mut.isPending ? "Encolando..." : "Enviar mensaje de prueba"}
            </Button>
          </form>
          <div className="mt-4 text-xs text-muted-foreground space-y-1">
            <p className="font-medium">Cómo probar recepción:</p>
            <p>
              Pide al contacto destino que responda. La extensión captura el
              mensaje y lo verás aparecer en la lista de chats.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
