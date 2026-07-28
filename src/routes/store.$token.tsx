import { Outlet, createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchStoreConfig, type StoreConfigPublic } from "@/lib/store-client";
import { MessageCircle, Store } from "lucide-react";

export const Route = createFileRoute("/store/$token")({
  component: StoreLayout,
});

/** Acento tipo Sincro (cian) a partir del primary, o default. */
function accentFromPrimary(primary: string): string {
  const p = (primary || "").trim();
  if (!p) return "#00FFAA";
  // Si el operador ya usa naranja Temu, forzar acento cian Syncro
  if (/^#?(ff6a00|f97316|ea580c)$/i.test(p.replace("#", ""))) return "#00FFAA";
  return "#00FFAA";
}

function StoreLayout() {
  const { token } = useParams({ from: "/store/$token" });
  const [cfg, setCfg] = useState<StoreConfigPublic | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStoreConfig(token)
      .then((c) => {
        if (!cancelled) setCfg(c);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || "Tienda no disponible");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!cfg) return;
    const primary = cfg.primaryColor || "#0056AD";
    const accent = accentFromPrimary(primary);
    document.documentElement.style.setProperty("--store-primary", primary);
    document.documentElement.style.setProperty("--store-accent", accent);
    document.documentElement.style.setProperty("--store-primary-rgb", hexToRgb(primary));
    document.documentElement.style.setProperty("--store-accent-rgb", hexToRgb(accent));
    document.title = cfg.brandName || "Catálogo";
  }, [cfg]);

  if (err) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060a12] px-4 text-white">
        <div className="max-w-sm text-center">
          <p className="text-4xl mb-3">📦</p>
          <h1 className="text-xl font-semibold">Catálogo en pausa</h1>
          <p className="mt-2 text-sm text-white/60">{err}</p>
        </div>
      </div>
    );
  }

  if (!cfg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060a12]">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--store-primary, #0056AD)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  return (
    <div
      className="catalog-theme-root relative flex min-h-screen flex-col text-white"
      style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        background: "#060a12",
        ["--store-primary" as string]: cfg.primaryColor || "#0056AD",
        ["--store-accent" as string]: accentFromPrimary(cfg.primaryColor),
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
      />

      {/* Glow blobs — estilo CatalogoPublico Sincro */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div
          className="absolute left-1/4 top-[-10%] h-[450px] w-[150%] max-w-4xl rounded-full blur-[140px] md:w-[80%]"
          style={{ background: "color-mix(in srgb, var(--store-primary) 18%, transparent)", opacity: 0.7 }}
        />
        <div
          className="absolute bottom-[-5%] right-[-10%] h-[350px] w-[50%] rounded-full blur-[130px]"
          style={{ background: "color-mix(in srgb, var(--store-accent) 12%, transparent)", opacity: 0.55 }}
        />
        <div
          className="absolute left-[-10%] top-[40%] h-[300px] w-[35%] rounded-full blur-[110px]"
          style={{ background: "color-mix(in srgb, var(--store-primary) 10%, transparent)", opacity: 0.35 }}
        />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#060a12]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/store/$token" params={{ token }} className="flex min-w-0 items-center gap-2.5">
            {cfg.logoUrl ? (
              <img
                src={cfg.logoUrl}
                alt=""
                className="h-9 w-9 rounded-full object-cover ring-1 ring-white/20"
              />
            ) : (
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full text-white shadow-lg"
                style={{ background: "var(--store-primary)" }}
              >
                <Store className="h-4 w-4" />
              </span>
            )}
            <span className="truncate text-base font-semibold tracking-tight text-white/95 sm:text-lg">
              {cfg.brandName}
            </span>
          </Link>
          <Link
            to="/store/$token/chat"
            params={{ token }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold text-white shadow-md transition hover:brightness-110 active:scale-[0.98]"
            style={{ background: "var(--store-primary)" }}
          >
            <MessageCircle className="h-4 w-4" />
            Chat
          </Link>
        </div>
      </header>

      <div className="relative z-10 flex-1">
        <Outlet />
      </div>

      <link
        rel="manifest"
        href={`/store-manifest?token=${encodeURIComponent(token)}&name=${encodeURIComponent(cfg.brandName)}`}
      />
    </div>
  );
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "").trim();
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return `${r}, ${g}, ${b}`;
  }
  if (h.length >= 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].every((n) => !Number.isNaN(n))) return `${r}, ${g}, ${b}`;
  }
  return "0, 86, 173";
}
