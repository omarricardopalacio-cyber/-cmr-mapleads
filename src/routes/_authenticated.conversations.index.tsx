import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listThreads } from "@/lib/crm.functions";
import { sendDirectMessage } from "@/lib/messaging.functions";
import { listSessions } from "@/lib/sessions.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/conversations/")({
  component: ConversationsPage,
});

function ConversationsPage() {
  const fn = useServerFn(listThreads);
  const { data, isLoading } = useQuery({ queryKey: ["threads"], queryFn: () => fn({}) });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Conversaciones</h1>
        <p className="text-muted-foreground text-sm">Hilos recibidos desde el motor WhatsApp.</p>
      </div>

      <DirectSendPanel />

      <div className="grid gap-2">
        {isLoading && <p className="text-muted-foreground">Cargando...</p>}
        {!isLoading && (data?.threads.length ?? 0) === 0 && (
          <Card className="p-6 text-center text-muted-foreground">
            Sin conversaciones aún. Usa el panel de arriba para enviar un mensaje directo.
          </Card>
        )}
        {data?.threads.map((t) => {
          const contact = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
          return (
            <Link key={t.id} to="/conversations/$threadId" params={{ threadId: t.id }} className="block">
              <Card className="p-4 flex items-center justify-between hover:bg-muted/40 transition-colors">
                <div>
                  <div className="font-medium">{contact?.display_name || contact?.wa_id || t.contact_id}</div>
                  <div className="text-xs text-muted-foreground font-mono">{contact?.wa_id}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t.last_message_at ? new Date(t.last_message_at).toLocaleString() : "—"}
                  {t.unread_count > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs px-2 py-0.5">
                      {t.unread_count}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function DirectSendPanel() {
  const sessionsFn = useServerFn(listSessions);
  const sendFn = useServerFn(sendDirectMessage);
  const { data: sessionsData } = useQuery({ queryKey: ["sessions"], queryFn: () => sessionsFn({}) });

  const [sessionId, setSessionId] = useState("");
  const [chatId, setChatId] = useState("");
  const [text, setText] = useState("");

  const mut = useMutation({
    mutationFn: (vars: { sessionId: string; chatId: string; text: string }) =>
      sendFn({ data: vars }),
    onSuccess: (r) => {
      toast.success(`Comando encolado (${r.commandId.slice(0, 8)}). La extensión lo enviará.`);
      setText("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sessions = sessionsData?.sessions ?? [];
  const connected = sessions.filter((s) => s.status === "connected");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sid = sessionId || connected[0]?.id || sessions[0]?.id;
    if (!sid) return toast.error("No hay sesiones. Crea una en Sesiones WhatsApp.");
    if (!chatId.trim()) return toast.error("Falta el número/chatId");
    if (!text.trim()) return toast.error("Falta el texto");
    mut.mutate({ sessionId: sid, chatId: chatId.trim(), text: text.trim() });
  };

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="font-medium">Enviar mensaje directo</h2>
        <p className="text-xs text-muted-foreground">
          Encola un comando que la extensión recogerá y enviará por WhatsApp Web.
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <select
            className="bg-background border rounded-md px-3 py-2 text-sm"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          >
            <option value="">
              {sessions.length === 0 ? "Sin sesiones" : `Sesión (auto: ${connected[0]?.label || sessions[0]?.label || "?"})`}
            </option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} — {s.status}
              </option>
            ))}
          </select>
          <Input
            placeholder="Número (ej: 521234567890) o chatId completo"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
          />
        </div>
        <Textarea
          placeholder="Mensaje a enviar..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={mut.isPending}>
            {mut.isPending ? "Enviando..." : "Enviar"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
