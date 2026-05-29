import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { listMessages, sendMessage } from "@/lib/messaging.functions";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/conversations/$threadId")({
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const qc = useQueryClient();
  const list = useServerFn(listMessages);
  const send = useServerFn(sendMessage);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => list({ data: { threadId } }),
    refetchInterval: 5000,
  });

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [data?.messages.length]);

  useEffect(() => {
    const ch = supabase
      .channel(`thread-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        () => qc.invalidateQueries({ queryKey: ["thread", threadId] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [threadId, qc]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await send({ data: { threadId, text: text.trim() } });
      setText("");
      toast.success("Mensaje encolado");
    } catch (err: any) {
      toast.error(err?.message ?? "Error al enviar");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card">
        <Button asChild variant="ghost" size="icon" className="md:hidden">
          <Link to="/conversations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium">
          {(data?.thread.contact.displayName || data?.thread.contact.waId || "?")
            .slice(0, 1)
            .toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">
            {data?.thread.contact.displayName || data?.thread.contact.waId || "Conversación"}
          </div>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {data?.thread.contact.waId}
          </div>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto p-4 space-y-2"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground) / 0.08) 1px, transparent 0)",
          backgroundSize: "20px 20px",
        }}
      >
        {isLoading && <p className="text-muted-foreground text-sm">Cargando...</p>}
        {!isLoading && data?.messages.length === 0 && (
          <p className="text-muted-foreground text-sm text-center">Sin mensajes aún.</p>
        )}
        {data?.messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm ${
              m.direction === "out"
                ? "ml-auto bg-primary text-primary-foreground"
                : "mr-auto bg-card border"
            }`}
          >
            <div className="whitespace-pre-wrap break-words">
              {m.text || <i className="opacity-60">[media]</i>}
            </div>
            <div className="text-[10px] opacity-70 mt-1 text-right">
              {new Date(m.sent_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSend} className="border-t p-3 flex gap-2 bg-card">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe un mensaje..."
          disabled={sending}
          autoFocus
        />
        <Button type="submit" disabled={sending || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
