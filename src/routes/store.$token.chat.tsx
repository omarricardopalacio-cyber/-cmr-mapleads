import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  fetchChatMessages,
  fetchStoreConfig,
  fetchStoreProducts,
  loadStoreLead,
  openChatSession,
  saveStoreLead,
  sendChatMessage,
  visitorStorageKey,
} from "@/lib/store-client";
import { ArrowLeft, ChevronLeft, ChevronRight, Gift, Play, Send } from "lucide-react";
import {
  StoreInstallBanner,
  clearStoreBadgeAndMarkRead,
  enableStorePush,
  registerStoreServiceWorker,
} from "@/components/store/StoreInstallBanner";
import { hasRealStoreVideo, resolveStoreMedia } from "@/lib/store-media";

const searchSchema = z.object({
  productId: z.string().optional(),
  productName: z.string().optional(),
});

export const Route = createFileRoute("/store/$token/chat")({
  validateSearch: (s) => searchSchema.parse(s),
  component: StoreChatPage,
});

type BubbleMedia = {
  url?: string;
  mimeType?: string;
  type?: string;
} | null;

type Bubble = {
  id: string;
  direction: "in" | "out";
  text: string;
  media: BubbleMedia;
  sent_at: string;
};

type MediaSlide =
  | { key: string; kind: "video"; videoUrl: string; poster: string | null }
  | { key: string; kind: "image"; url: string };

function buildMediaSlides(
  videoUrl: string | null,
  imageUrl: string | null,
  galleryImages: string[],
): MediaSlide[] {
  const slides: MediaSlide[] = [];
  const seen = new Set<string>();
  const addImage = (url: string, key: string) => {
    const u = url.trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    slides.push({ key, kind: "image", url: u });
  };

  if (hasRealStoreVideo(videoUrl)) {
    slides.push({
      key: "video",
      kind: "video",
      videoUrl: videoUrl!.trim(),
      poster: imageUrl?.trim() || null,
    });
    if (imageUrl?.trim()) seen.add(imageUrl.trim());
  } else if (imageUrl?.trim()) {
    addImage(imageUrl, "main");
  }

  for (let i = 0; i < galleryImages.length; i++) {
    addImage(galleryImages[i]!, `g-${i}`);
  }

  // Si no había video/imagen principal pero sí galería, ya están en slides
  if (slides.length === 0 && imageUrl?.trim()) addImage(imageUrl, "main");
  return slides;
}

function mediaKind(media: BubbleMedia): "image" | "video" | null {
  if (!media?.url) return null;
  const t = `${media.type || ""} ${media.mimeType || ""}`.toLowerCase();
  if (t.includes("video") || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(media.url)) return "video";
  if (t.includes("image") || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(media.url)) return "image";
  return null;
}

function normalizePhoneInput(raw: string): string {
  return raw.replace(/[^\d+\s()-]/g, "").slice(0, 20);
}

function isValidWhatsApp(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function StickyProductMedia({
  videoUrl,
  imageUrl,
  galleryImages = [],
  productName,
}: {
  videoUrl: string | null;
  imageUrl: string | null;
  galleryImages?: string[];
  productName: string | null;
}) {
  const slides = buildMediaSlides(videoUrl, imageUrl, galleryImages);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
    setVideoFailed(false);
  }, [videoUrl, imageUrl, galleryImages.join("|")]);

  useEffect(() => {
    setPlaying(false);
    setVideoFailed(false);
  }, [index]);

  if (slides.length === 0) return null;

  const safeIndex = Math.min(index, slides.length - 1);
  const slide = slides[safeIndex]!;
  const canNavigate = slides.length > 1;

  const media =
    slide.kind === "video"
      ? resolveStoreMedia(slide.videoUrl, slide.poster)
      : ({ kind: "image" as const, src: slide.url });

  const showEmbed =
    media.kind === "youtube" || media.kind === "vimeo" || media.kind === "drive";
  const canVideo = slide.kind === "video" && media.kind === "video" && !videoFailed;
  const showVideoButton = canVideo && !playing;

  const posterSrc =
    slide.kind === "image"
      ? slide.url
      : slide.poster || (media.kind === "image" ? media.src : null);

  const go = (dir: -1 | 1) => {
    setIndex((i) => {
      const next = i + dir;
      if (next < 0) return slides.length - 1;
      if (next >= slides.length) return 0;
      return next;
    });
  };

  const isImageSlide = slide.kind === "image" || (slide.kind === "video" && (!playing || videoFailed));
  const mediaBg = showEmbed || (canVideo && playing) ? "bg-black" : "bg-white";

  return (
    <div className={`shrink-0 border-b border-black/10 shadow-md ${mediaBg}`}>
      <div className={`relative h-48 w-full overflow-hidden sm:h-56 ${mediaBg}`}>
        {showEmbed ? (
          <iframe
            src={media.embed}
            title={productName || "Video del producto"}
            className="absolute inset-0 h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : null}

        {canVideo && playing ? (
          <video
            key={`${media.src}-play`}
            src={media.src}
            controls
            playsInline
            autoPlay
            preload="auto"
            poster={slide.kind === "video" ? slide.poster || undefined : undefined}
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => {
              setVideoFailed(true);
              setPlaying(false);
            }}
            ref={(el) => {
              if (el) void el.play().catch(() => {});
            }}
          />
        ) : null}

        {!showEmbed &&
        (slide.kind === "image" ||
          (slide.kind === "video" && (!playing || videoFailed)) ||
          (slide.kind === "video" && media.kind === "image")) &&
        posterSrc ? (
          <img
            src={posterSrc}
            alt={productName || "Producto"}
            className="absolute inset-0 h-full w-full object-contain bg-white"
          />
        ) : null}

        {/* Solo si hay video real en esta diapositiva */}
        {showVideoButton ? (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="absolute inset-0 z-[1] flex items-center justify-center bg-black/20"
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-black shadow-lg">
              <Play className="h-5 w-5 fill-black" />
              Ver video
            </span>
          </button>
        ) : null}

        {canNavigate ? (
          <>
            <button
              type="button"
              aria-label="Anterior"
              onClick={() => go(-1)}
              className="absolute left-2 top-1/2 z-[2] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow hover:bg-black/75"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Siguiente"
              onClick={() => go(1)}
              className="absolute right-2 top-1/2 z-[2] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow hover:bg-black/75"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="absolute bottom-2 left-0 right-0 z-[2] flex justify-center gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  aria-label={`Media ${i + 1}`}
                  onClick={() => setIndex(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === safeIndex
                      ? isImageSlide
                        ? "w-4 bg-stone-800"
                        : "w-4 bg-white"
                      : isImageSlide
                        ? "w-1.5 bg-stone-400"
                        : "w-1.5 bg-white/45"
                  }`}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
      {productName ? (
        <p className="truncate bg-[#0b101a] px-3 py-1.5 text-center text-[11px] font-medium text-white/70">
          {productName}
          {canNavigate ? ` · ${safeIndex + 1}/${slides.length}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function LeadGateForm({
  token,
  productName,
  initialName,
  initialPhone,
  submitting,
  error,
  onSubmit,
}: {
  token: string;
  productName?: string;
  initialName?: string;
  initialPhone?: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (name: string, phone: string) => void;
}) {
  const [name, setName] = useState(initialName || "");
  const [phone, setPhone] = useState(initialPhone || "");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const n = name.trim();
    const p = phone.trim();
    if (n.length < 2) {
      setLocalError("Escribe tu nombre");
      return;
    }
    if (!isValidWhatsApp(p)) {
      setLocalError("Número de WhatsApp inválido (mín. 10 dígitos)");
      return;
    }
    onSubmit(n, p);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-57px)] max-w-lg flex-col bg-[#E5DDD5] text-black">
      <div className="flex items-center gap-3 px-3 py-2.5 text-white shadow" style={{ background: "#075E54" }}>
        <Link to="/store/$token" params={{ token }} className="rounded p-1 hover:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Antes de continuar</p>
          <p className="truncate text-[11px] text-emerald-100/90">
            {productName ? `Producto: ${productName}` : "Atención personalizada"}
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center overflow-y-auto p-4">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg"
        >
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <Gift className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold text-stone-900">Información personalizada</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
            Para darte información más personalizada y un{" "}
            <span className="font-semibold text-emerald-700">descuento especial a nuevos clientes</span>
            , por favor llena tu nombre y número de WhatsApp.
          </p>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-stone-500">
            Nombre
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre"
            autoComplete="name"
            className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-black caret-black outline-none focus:border-emerald-500"
            style={{ color: "#000000", WebkitTextFillColor: "#000000" }}
            disabled={submitting}
          />

          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-stone-500">
            WhatsApp
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(normalizePhoneInput(e.target.value))}
            placeholder="Ej: 300 123 4567"
            inputMode="tel"
            autoComplete="tel"
            className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-black caret-black outline-none focus:border-emerald-500"
            style={{ color: "#000000", WebkitTextFillColor: "#000000" }}
            disabled={submitting}
          />

          {(localError || error) && (
            <p className="mt-3 text-xs text-red-600">{localError || error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 w-full rounded-full bg-[#008069] py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {submitting ? "Abriendo chat…" : "Continuar al chat"}
          </button>
        </form>
      </div>
    </div>
  );
}

function StoreChatPage() {
  const { token } = useParams({ from: "/store/$token/chat" });
  const search = Route.useSearch();
  const [leadReady, setLeadReady] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [visitorToken, setVisitorToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedName, setFocusedName] = useState<string | null>(search.productName || null);
  const [stickyImage, setStickyImage] = useState<string | null>(null);
  const [stickyVideo, setStickyVideo] = useState<string | null>(null);
  const [stickyGallery, setStickyGallery] = useState<string[]>([]);
  const [brandName, setBrandName] = useState("Tienda");
  const [pushEnabled, setPushEnabled] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastCount = useRef(0);
  const bootKey = useRef<string>("");
  const nextDueAt = useRef<number | null>(null);

  useEffect(() => {
    const existing = loadStoreLead(token);
    if (existing) {
      setLeadName(existing.name);
      setLeadPhone(existing.phone);
      setLeadReady(true);
    }
    registerStoreServiceWorker().catch(() => {});
    fetchStoreConfig(token)
      .then((c) => setBrandName(c.brandName || "Tienda"))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!visitorToken || !ready) return;
    clearStoreBadgeAndMarkRead({ storeToken: token, visitorToken }).catch(() => {});
  }, [visitorToken, ready, token]);

  const scrollDown = useCallback((force = false) => {
    if (!force && !stickToBottom.current) return;
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: force ? "smooth" : "auto" });
    });
  }, []);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = dist < 80;
  };

  const refresh = useCallback(
    async (vis: string, opts?: { forceScroll?: boolean }) => {
      const data = await fetchChatMessages(token, vis);
      const mapped = (data.messages || []).map((m) => ({
        id: m.id,
        direction: m.direction as "in" | "out",
        text: m.text || "",
        media: (m.media as BubbleMedia) || null,
        sent_at: m.sent_at,
      }));
      const now = Date.now();
      let nextDue: number | null = null;
      const visible = mapped.filter((m) => {
        const at = m.sent_at ? new Date(m.sent_at).getTime() : 0;
        if (at > now) {
          if (nextDue == null || at < nextDue) nextDue = at;
          return false;
        }
        if (m.text?.trim()) return true;
        return mediaKind(m.media) != null;
      });
      nextDueAt.current = nextDue;
      const grew = visible.length > lastCount.current;
      lastCount.current = visible.length;
      setMessages(visible);
      if (opts?.forceScroll || (grew && stickToBottom.current)) {
        scrollDown(!!opts?.forceScroll);
      }
    },
    [token, scrollDown],
  );

  useEffect(() => {
    if (!leadReady || !leadName || !leadPhone) return;
    const key = `${token}|${search.productId || ""}|${leadName}|${leadPhone}`;
    if (bootKey.current === key) return;
    bootKey.current = key;

    let cancelled = false;
    (async () => {
      try {
        setError(null);
        setReady(false);
        setFormSubmitting(true);
        const stored = localStorage.getItem(visitorStorageKey(token)) || undefined;
        const session = await openChatSession(token, {
          visitorToken: stored,
          productId: search.productId,
          productName: search.productName,
          displayName: leadName,
          phone: leadPhone,
          startProduct: true,
        });
        if (cancelled) return;
        localStorage.setItem(visitorStorageKey(token), session.visitorToken);
        setVisitorToken(session.visitorToken);

        if (session.productFocus?.productName) {
          setFocusedName(session.productFocus.productName);
        } else if (search.productName) {
          setFocusedName(search.productName);
        }

        let img = session.productFocus?.imageUrl || null;
        let vid = session.productFocus?.videoUrl || null;
        let gallery = Array.isArray(session.productFocus?.galleryImages)
          ? [...session.productFocus.galleryImages]
          : [];

        if (search.productId && (!img || !vid || gallery.length === 0)) {
          try {
            const res = await fetchStoreProducts(token, { id: search.productId });
            const p = res.products[0];
            if (p) {
              if (!img && p.image_url) img = p.image_url;
              if (!vid && p.video_url) vid = p.video_url;
              if (gallery.length === 0 && Array.isArray(p.gallery_images)) {
                gallery = p.gallery_images.filter((u): u is string => typeof u === "string" && !!u.trim());
              }
              if (!session.productFocus?.productName) setFocusedName(p.name);
            }
          } catch {
            /* ignore */
          }
        }

        if (!cancelled) {
          setStickyImage(img);
          setStickyVideo(vid);
          setStickyGallery(gallery);
          stickToBottom.current = true;
          await refresh(session.visitorToken, { forceScroll: true });
          setReady(true);
        }
      } catch (e: any) {
        if (!cancelled) {
          bootKey.current = "";
          setError(e.message || "No se pudo abrir el chat");
        }
      } finally {
        if (!cancelled) setFormSubmitting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leadReady, leadName, leadPhone, token, search.productId, search.productName, refresh]);

  useEffect(() => {
    if (!visitorToken || !ready) return;
    const tick = () => {
      refresh(visitorToken).catch(() => {});
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [visitorToken, ready, refresh]);

  // Cuando hay mensajes programados, refrescar exactamente al vencer el siguiente
  useEffect(() => {
    if (!visitorToken || !ready) return;
    const due = nextDueAt.current;
    if (!due) return;
    const wait = Math.max(50, due - Date.now() + 30);
    const t = setTimeout(() => {
      refresh(visitorToken).catch(() => {});
    }, wait);
    return () => clearTimeout(t);
  }, [visitorToken, ready, refresh, messages.length]);

  async function onLeadSubmit(name: string, phone: string) {
    setFormSubmitting(true);
    setError(null);
    try {
      saveStoreLead(token, { name, phone });
      setLeadName(name);
      setLeadPhone(phone);
      setLeadReady(true);
    } catch (e: any) {
      setError(e.message || "No se pudo guardar");
      setFormSubmitting(false);
    }
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!visitorToken || !text.trim() || sending) return;
    const body = text.trim();
    setText("");
    setSending(true);
    stickToBottom.current = true;
    const optimistic: Bubble = {
      id: `tmp-${Date.now()}`,
      direction: "in",
      text: body,
      media: null,
      sent_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    scrollDown(true);
    try {
      await sendChatMessage(token, visitorToken, body);
      await refresh(visitorToken, { forceScroll: true });
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

  if (!leadReady) {
    return (
      <LeadGateForm
        token={token}
        productName={search.productName || focusedName || undefined}
        initialName={leadName}
        initialPhone={leadPhone}
        submitting={formSubmitting}
        error={error}
        onSubmit={onLeadSubmit}
      />
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-57px)] max-w-lg flex-col bg-[#E5DDD5] text-black [color-scheme:light]">
      <div
        className="flex shrink-0 items-center gap-3 px-3 py-2.5 text-white shadow"
        style={{ background: "#075E54" }}
      >
        <Link to="/store/$token" params={{ token }} className="rounded p-1 hover:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
          {(leadName || "A").charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Atención</p>
          <p className="truncate text-[11px] text-emerald-100/90">
            {sending
              ? "escribiendo…"
              : focusedName
                ? `Producto: ${focusedName}`
                : "en línea"}
          </p>
        </div>
      </div>

      {(stickyVideo || stickyImage || stickyGallery.length > 0) ? (
        <StickyProductMedia
          videoUrl={stickyVideo}
          imageUrl={stickyImage}
          galleryImages={stickyGallery}
          productName={focusedName}
        />
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onListScroll}
          className="absolute inset-0 overflow-y-auto px-3 py-3"
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
            <p className="text-center text-xs text-stone-600">
              {formSubmitting ? "Preparando tu atención…" : "Conectando chat…"}
            </p>
          )}
          {messages.map((m) => {
            const mine = m.direction === "in";
            const kind = mediaKind(m.media);
            return (
              <div key={m.id} className={`mb-1.5 flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[82%] overflow-hidden rounded-lg px-2.5 py-1.5 shadow-sm ${
                    mine ? "rounded-tr-none bg-[#DCF8C6]" : "rounded-tl-none bg-white"
                  }`}
                >
                  {kind === "image" && m.media?.url ? (
                    <a href={m.media.url} target="_blank" rel="noreferrer" className="block">
                      <img
                        src={m.media.url}
                        alt=""
                        className="mb-1 max-h-52 w-full rounded-md bg-white object-contain"
                      />
                    </a>
                  ) : null}
                  {kind === "video" && m.media?.url ? (
                    <video
                      src={m.media.url}
                      controls
                      playsInline
                      preload="metadata"
                      className="mb-1 max-h-40 w-full rounded-md bg-black object-contain"
                    />
                  ) : null}
                  {m.text ? (
                    <p className="whitespace-pre-wrap text-[14.2px] leading-snug text-black">
                      {m.text}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-right text-[10px] text-stone-500">
                    {formatTime(m.sent_at)}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={onSend}
        className="flex shrink-0 items-end gap-2 bg-[#F0F2F5] px-2 py-2 text-black"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe un mensaje"
          className="min-h-[42px] flex-1 rounded-full border-0 bg-white px-4 py-2.5 text-sm text-black caret-black outline-none placeholder:text-stone-400 !text-black"
          style={{ color: "#000000", WebkitTextFillColor: "#000000" }}
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

      {visitorToken && ready ? (
        <StoreInstallBanner
          brandName={brandName}
          pushEnabled={pushEnabled}
          onEnablePush={async () => {
            const r = await enableStorePush({
              storeToken: token,
              visitorToken,
            });
            if (r.ok) {
              setPushEnabled(true);
              return true;
            }
            setError(r.error || "No se pudieron activar avisos");
            return false;
          }}
        />
      ) : null}
    </div>
  );
}
