import { Outlet, createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchStoreConfig, type StoreConfigPublic } from "@/lib/store-client";
import { MessageCircle, Store } from "lucide-react";

export const Route = createFileRoute("/store/$token")({
  component: StoreLayout,
});

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
    document.documentElement.style.setProperty("--store-accent", cfg.primaryColor || "#FF6A00");
    document.title = cfg.brandName || "Tienda";
  }, [cfg]);

  if (err) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F0EB] px-4">
        <p className="text-center text-sm text-stone-600">{err}</p>
      </div>
    );
  }

  if (!cfg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F0EB]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F0EB] text-stone-900" style={{ fontFamily: '"DM Sans", "Segoe UI", sans-serif' }}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap"
      />
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-[#F5F0EB]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/store/$token" params={{ token }} className="flex items-center gap-2">
            {cfg.logoUrl ? (
              <img src={cfg.logoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-white"
                style={{ background: cfg.primaryColor }}
              >
                <Store className="h-4 w-4" />
              </span>
            )}
            <span
              className="text-lg font-semibold tracking-tight"
              style={{ fontFamily: "Fraunces, Georgia, serif" }}
            >
              {cfg.brandName}
            </span>
          </Link>
          <Link
            to="/store/$token/chat"
            params={{ token }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-white shadow-sm"
            style={{ background: cfg.primaryColor }}
          >
            <MessageCircle className="h-4 w-4" />
            Chat
          </Link>
        </div>
      </header>
      <Outlet />
      <link rel="manifest" href={`/store-manifest?token=${encodeURIComponent(token)}&name=${encodeURIComponent(cfg.brandName)}`} />
    </div>
  );
}
