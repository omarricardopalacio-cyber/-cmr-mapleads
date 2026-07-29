import { Outlet, createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchStoreConfig, type StoreConfigPublic } from "@/lib/store-client";
import { MessageCircle, Store } from "lucide-react";
import { registerStoreServiceWorker } from "@/components/store/StoreInstallBanner";
import { ensureGoogleAnalytics, ensureMetaPixel, trackMetaEvent } from "@/lib/meta-pixel-browser";

export const Route = createFileRoute("/store/$token")({
  component: StoreLayout,
});

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function upsertLink(rel: string, href: string) {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
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
    registerStoreServiceWorker().catch(() => {});
  }, []);

  useEffect(() => {
    if (!cfg) return;
    const primary = cfg.primaryColor || "#0056AD";
    const accent = cfg.accentColor || "#FF2D95";
    document.documentElement.style.setProperty("--store-primary", primary);
    document.documentElement.style.setProperty("--store-accent", accent);
    const title = cfg.seoTitle || cfg.socialTitle || cfg.brandName || "Catálogo";
    document.title = title;

    const desc = cfg.seoDescription || cfg.socialDescription || `Catálogo de ${cfg.brandName}`;
    const image = cfg.socialImageUrl || cfg.logoUrl || "";
    const url = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";

    upsertMeta("name", "description", desc);
    upsertMeta("name", "theme-color", accent || "#008069");
    upsertMeta("name", "mobile-web-app-capable", "yes");
    upsertMeta("name", "apple-mobile-web-app-capable", "yes");
    upsertMeta("name", "apple-mobile-web-app-title", cfg.brandName.slice(0, 12));
    if (cfg.googleSiteVerification) {
      upsertMeta("name", "google-site-verification", cfg.googleSiteVerification);
    }
    upsertMeta("property", "og:title", cfg.socialTitle || title);
    upsertMeta("property", "og:description", desc);
    upsertMeta("property", "og:type", "website");
    if (url) {
      upsertMeta("property", "og:url", url);
      upsertLink("canonical", url);
    }
    if (image) {
      upsertMeta("property", "og:image", image);
      upsertMeta("property", "og:image:width", "1200");
      upsertMeta("property", "og:image:height", "630");
    }
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", cfg.socialTitle || title);
    upsertMeta("name", "twitter:description", desc);
    if (image) upsertMeta("name", "twitter:image", image);

    const manifestHref = `/store-manifest?token=${encodeURIComponent(token)}&name=${encodeURIComponent(cfg.brandName)}&theme=${encodeURIComponent(accent || "#008069")}${
      cfg.logoUrl ? `&logo=${encodeURIComponent(cfg.logoUrl)}` : ""
    }&start=chat`;
    upsertLink("manifest", manifestHref);
    upsertLink("apple-touch-icon", cfg.logoUrl || "/store-pwa-icon.svg");

    if (cfg.metaPixelEnabled && cfg.metaPixelId) {
      ensureMetaPixel(cfg.metaPixelId);
      trackMetaEvent("PageView");
    }
    if (cfg.googleAnalyticsId) {
      ensureGoogleAnalytics(cfg.googleAnalyticsId);
    }
  }, [cfg, token]);

  if (err) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060a12] px-4 text-white">
        <div className="max-w-sm text-center">
          <p className="mb-3 text-4xl">📦</p>
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
          style={{ borderColor: "var(--store-accent, #FF2D95)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  const footerLinks: Array<{ to: string; label: string; show?: boolean }> = [
    { to: `/store/${token}/legal/faq`, label: "FAQ", show: cfg.hasFaq },
    { to: `/store/${token}/legal/terms`, label: "Términos", show: cfg.hasTerms },
    { to: `/store/${token}/legal/privacy`, label: "Privacidad", show: cfg.hasPrivacy },
    { to: `/store/${token}/legal/shipping`, label: "Envíos y garantías", show: cfg.hasShipping },
  ];

  return (
    <div
      className="catalog-theme-root relative flex min-h-screen flex-col text-white"
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        background: "#060a12",
        ["--store-primary" as string]: cfg.primaryColor || "#0056AD",
        ["--store-accent" as string]: cfg.accentColor || "#FF2D95",
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
      />

      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div
          className="absolute left-1/4 top-[-10%] h-[450px] w-[150%] max-w-4xl rounded-full blur-[140px] md:w-[80%]"
          style={{ background: "color-mix(in srgb, var(--store-accent) 16%, transparent)", opacity: 0.55 }}
        />
        <div
          className="absolute bottom-[-5%] right-[-10%] h-[350px] w-[50%] rounded-full blur-[130px]"
          style={{ background: "color-mix(in srgb, var(--store-primary) 14%, transparent)", opacity: 0.45 }}
        />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#060a12]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link to="/store/$token" params={{ token }} className="flex min-w-0 items-center gap-2.5">
            {cfg.logoUrl ? (
              <img
                src={cfg.logoUrl}
                alt={cfg.brandName}
                className="h-9 w-9 rounded-lg object-cover ring-1 ring-white/20"
                width={36}
                height={36}
                loading="eager"
              />
            ) : (
              <span
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white"
                style={{ background: "var(--store-accent)" }}
              >
                <Store className="h-4 w-4" />
              </span>
            )}
            <span className="truncate text-base font-semibold tracking-tight sm:text-lg">{cfg.brandName}</span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 sm:flex">
            <Link
              to="/store/$token"
              params={{ token }}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: "var(--store-accent)" }}
            >
              Inicio
            </Link>
            <a
              href="#categorias"
              className="rounded-full px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/5 hover:text-white"
            >
              Categorías
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/store/$token/chat"
              params={{ token }}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold text-white shadow-md transition hover:brightness-110"
              style={{ background: "var(--store-accent)" }}
            >
              <MessageCircle className="h-4 w-4" />
              Contacto
            </Link>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex-1">
        <Outlet />
      </div>

      {(cfg.hasFaq || cfg.hasTerms || cfg.hasPrivacy || cfg.hasShipping) && (
        <footer className="relative z-10 border-t border-white/10 bg-[#060a12]/90 px-4 py-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-white/60">
            {footerLinks
              .filter((l) => l.show)
              .map((l) => (
                <a key={l.to} href={l.to} className="hover:text-white">
                  {l.label}
                </a>
              ))}
            <span className="text-white/30">·</span>
            <span>{cfg.brandName}</span>
          </div>
        </footer>
      )}
    </div>
  );
}
