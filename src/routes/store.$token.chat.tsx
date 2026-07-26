import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  fetchChatMessages,
  openChatSession,
  sendChatMessage,
  visitorStorageKey,
} from "@/lib/store-client";
import { ArrowLeft, Send } from "lucide-react";

const searchSchema = z.object({
  productId: z.string().optional(),
  productName: z.string().optional(),
});

export const Route = createFileRoute("/store/$token/chat")({
  validateSearch: (s) => searchSchema.parse(s),
  component: StoreChatPage,
});

type Bubble = {
  id: string;
  direction: "in" | "out";
  text: string;
  sent_at: string;
};

function StoreChatPage() {
  const { token } = useParams({ from: "/store/$token/chat" });
  const search = Route.useSearch();
  const [visitorToken, setVisitorToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const productHintSent = useRef(false);

  const scrollDown = () => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  };

  const refresh = useCallback(async (vis: string) => {
    const data = await fetchChatMessages(token, vis);
    setMessages(
      (data.messages || []).map((m) => ({
        id: m.id,
        direction: m.direction,
        text: m.text || "",
        sent_at: m.sent_at,
      })),
    );
    scrollDown();
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = localStorage.getItem(visitorStorageKey(token)) || undefined;
        const session = await openChatSession(token, {
          visitorToken: stored,
          productId: search.productId,
          productName: search.productName,
        });
        if (cancelled) return;
        localStorage.setItem(visitorStorageKey(token), session.visitorToken);
        setVisitorToken(session.visitorToken);
        await refresh(session.visitorToken);

        if (session.productHint && !productHintSent.current) {
          productHintSent.current = true;
          setSending(true);
          await sendChatMessage(token, session.visitorToken, session.productHint);
          await refresh(session.visitorToken);
          setSending(false);
        }
        setReady(true);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "No se pudo abrir el chat");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, search.productId, search.productName, refresh]);

  useEffect(() => {
    if (!visitorToken) return;
    const id = setInterval(() => {
      refresh(visitorToken).catch(() => {});
    }, 2500);
    return () => clearInterval(id);
  }, [visitorToken, refresh]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!visitorToken || !text.trim() || sending) return;
    const body = text.trim();
    setText("");
    setSending(true);
    const optimistic: Bubble = {
      id: `tmp-${Date.now()}`,
      direction: "in",
      text: body,
      sent_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    scrollDown();
    try {
      await sendChatMessage(token, visitorToken, body);
      await refresh(visitorToken);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function formatTime(iso: string) {
    try {
      return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-57px)] max-w-lg flex-col bg-[#E5DDD5]">
      <div
        className="flex items-center gap-3 px-3 py-2.5 text-white shadow"
        style={{ background: "#075E54" }}
      >
        <Link to="/store/$token" params={{ token }} className="rounded p-1 hover:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
          A
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Atención</p>
          <p className="text-[11px] text-emerald-100/90">
            {sending ? "escribiendo…" : "en línea"}
          </p>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-3 py-3"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4c4b0' fill-opacity='0.35'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      >
        {error && (
          <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-center text-xs text-red-700">
            {error}
          </p>
        )}
        {!ready && !error && (
          <p className="text-center text-xs text-stone-600">Conectando chat…</p>
        )}
        {messages.map((m) => {
          const mine = m.direction === "in";
          return (
            <div key={m.id} className={`mb-1.5 flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[82%] rounded-lg px-2.5 py-1.5 shadow-sm ${
                  mine ? "rounded-tr-none bg-[#DCF8C6]" : "rounded-tl-none bg-white"
                }`}
              >
                <p className="whitespace-pre-wrap text-[14.2px] leading-snug text-stone-900">
                  {m.text}
                </p>
                <p className="mt-0.5 text-right text-[10px] text-stone-500">
                  {formatTime(m.sent_at)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={onSend}
        className="flex items-end gap-2 bg-[#F0F2F5] px-2 py-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe un mensaje"
          className="min-h-[42px] flex-1 rounded-full border-0 bg-white px-4 py-2.5 text-sm outline-none"
          disabled={!ready || sending}
        />
        <button
          type="submit"
          disabled={!ready || sending || !text.trim()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[#008069] text-white disabled:opacity-50"
        >
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
