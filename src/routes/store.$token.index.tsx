import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchStoreCategories,
  fetchStoreConfig,
  fetchStoreProducts,
  formatPrice,
  type StoreCategorySphere,
  type StoreProduct,
} from "@/lib/store-client";
import { isDirectPlayableVideo } from "@/lib/store-media";
import { ChevronRight, MessageCircle, Search, Star, X } from "lucide-react";

export const Route = createFileRoute("/store/$token/")({
  component: StoreHome,
});

const PAGE = 24;

function StoreHome() {
  const { token } = useParams({ from: "/store/$token/" });
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<StoreCategorySphere[]>([]);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    fetchStoreConfig(token)
      .then((c) => {
        setLogoUrl(c.logoUrl);
        setBrandName(c.brandName);
      })
      .catch(() => {});
    fetchStoreCategories(token)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [token]);

  const loadPage = useCallback(
    async (reset: boolean) => {
      if (busyRef.current) return;
      busyRef.current = true;
      if (reset) {
        setLoading(true);
        offsetRef.current = 0;
      } else {
        setLoadingMore(true);
      }
      try {
        const offset = reset ? 0 : offsetRef.current;
        const res = await fetchStoreProducts(token, {
          q: q.trim() || undefined,
          category: category || undefined,
          limit: PAGE,
          offset,
        });
        setProducts((prev) => (reset ? res.products : [...prev, ...res.products]));
        offsetRef.current = offset + res.products.length;
        setHasMore(res.hasMore);
        setTotal(res.total);
        setError(null);
      } catch (e: any) {
        setError(e.message || "Error al cargar");
      } finally {
        setLoading(false);
        setLoadingMore(false);
        busyRef.current = false;
      }
    },
    [token, q, category],
  );

  useEffect(() => {
    const t = setTimeout(() => void loadPage(true), q ? 280 : 0);
    return () => clearTimeout(t);
  }, [loadPage, q, category]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
          void loadPage(false);
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, loadingMore, loadPage]);

  return (
    <main className="mx-auto max-w-7xl px-4 pb-28 pt-4">
      {/* Logo / marca */}
      <section className="mb-5 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/15" />
        ) : (
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold text-white"
            style={{ background: "var(--store-accent)" }}
          >
            {(brandName || "T").slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/45">Tienda</p>
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{brandName || "Catálogo"}</h1>
          <p className="text-xs text-white/50">{total ? `${total} productos` : "Catálogo público"}</p>
        </div>
      </section>

      {/* Esferas de categorías */}
      {categories.length > 0 && (
        <section className="mb-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">Categorías</h2>
            {category && (
              <button
                type="button"
                onClick={() => setCategory(null)}
                className="text-xs font-medium"
                style={{ color: "var(--store-accent)" }}
              >
                Ver todas
              </button>
            )}
          </div>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 scrollbar-thin">
            {categories.map((c) => (
              <CategorySphere
                key={c.name}
                cat={c}
                active={category === c.name}
                onClick={() => setCategory((prev) => (prev === c.name ? null : c.name))}
              />
            ))}
          </div>
        </section>
      )}

      <div className="mb-5 flex flex-col gap-3 lg:flex-row">
        {/* Sidebar categorías */}
        <aside id="categorias" className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-[72px] rounded-xl border border-white/10 bg-[#0b101a] p-3">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className={`mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-bold transition ${
                !category ? "" : "text-white/80 hover:bg-white/5"
              }`}
              style={!category ? { color: "var(--store-accent)" } : undefined}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: "var(--store-accent)" }}
              />
              Todas las categorías
            </button>
            <div className="mb-2 border-t border-white/10" />
            <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto">
              {categories.map((c) => (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => setCategory(c.name)}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition ${
                      category === c.name
                        ? "font-bold"
                        : "font-medium text-white/75 hover:bg-white/5 hover:text-white"
                    }`}
                    style={category === c.name ? { color: "var(--store-accent)" } : undefined}
                  >
                    <span className="truncate uppercase tracking-wide">{c.name}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </button>
                </li>
              ))}
              {categories.length === 0 && (
                <li className="px-2 py-2 text-xs text-white/40">
                  Sin categorías. Sincroniza el catálogo Sincro.
                </li>
              )}
            </ul>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="relative mb-4 max-w-lg lg:ml-auto">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              type="search"
              placeholder="Buscar…"
              className="h-10 w-full rounded-full border border-white/15 bg-white/10 py-2 pl-10 pr-9 text-sm text-white caret-white outline-none placeholder:text-white/50 focus:ring-1 focus:ring-[color:var(--store-accent)]/50 [&::-webkit-search-cancel-button]:hidden"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {error && (
            <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </p>
          )}

          {loading && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-white/5" />
              ))}
            </div>
          )}

          {!loading && products.length === 0 && (
            <p className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-sm text-white/50">
              No hay productos{category ? ` en “${category}”` : ""}. Sincroniza el catálogo en el CRM.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} token={token} />
            ))}
          </div>

          <div ref={sentinelRef} className="h-10 w-full" />
          {loadingMore && (
            <p className="py-4 text-center text-xs text-white/45">Cargando más productos…</p>
          )}
          {!hasMore && products.length > 0 && (
            <p className="py-4 text-center text-xs text-white/35">Fin del catálogo · {total} productos</p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate({ to: "/store/$token/chat", params: { token } })}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white shadow-lg"
        style={{ background: "#25D366", boxShadow: "0 8px 28px rgba(37,211,102,0.35)" }}
      >
        <MessageCircle className="h-4 w-4" />
        Chat
      </button>
    </main>
  );
}

function CategorySphere({
  cat,
  active,
  onClick,
}: {
  cat: StoreCategorySphere;
  active: boolean;
  onClick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playable = isDirectPlayableVideo(cat.video_url);
  return (
    <button type="button" onClick={onClick} className="group flex w-[76px] shrink-0 flex-col items-center gap-1.5">
      <div
        className={`relative h-[68px] w-[68px] overflow-hidden rounded-full bg-white shadow-md ring-2 transition ${
          active ? "ring-[color:var(--store-accent)]" : "ring-white/20 group-hover:ring-white/50"
        }`}
        onMouseEnter={() => {
          if (!playable) return;
          const v = videoRef.current;
          if (v) {
            v.currentTime = 0;
            void v.play().catch(() => {});
          }
        }}
        onMouseLeave={() => {
          const v = videoRef.current;
          if (v) {
            v.pause();
            v.currentTime = 0;
          }
        }}
      >
        {cat.image_url ? (
          <img
            src={cat.image_url}
            alt=""
            className={`h-full w-full object-cover transition ${playable ? "group-hover:opacity-0" : ""}`}
            loading="lazy"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-lg font-bold text-white"
            style={{ background: "var(--store-accent)" }}
          >
            {cat.name.slice(0, 1)}
          </div>
        )}
        {playable && cat.video_url ? (
          <video
            ref={videoRef}
            src={cat.video_url}
            muted
            playsInline
            loop
            preload="metadata"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 transition group-hover:opacity-100"
          />
        ) : null}
      </div>
      <span className="w-full truncate text-center text-[9px] font-bold uppercase tracking-wide text-white/70">
        {cat.name}
      </span>
    </button>
  );
}

function ProductCard({ product: p, token }: { product: StoreProduct; token: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rating = 4.5 + ((p.id?.charCodeAt(0) || 0) % 5) * 0.1;
  const playable = isDirectPlayableVideo(p.video_url);
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b101a] shadow-sm transition hover:-translate-y-0.5 hover:border-white/20 hover:shadow-xl">
      <Link
        to="/store/$token/chat"
        params={{ token }}
        search={{ productId: p.id, productName: p.name }}
        className="relative block aspect-square overflow-hidden bg-[#121820]"
        onMouseEnter={() => {
          if (!playable) return;
          const v = videoRef.current;
          if (v) {
            if (v.readyState < 2) v.load();
            v.currentTime = 0;
            void v.play().catch(() => {});
          }
        }}
        onMouseLeave={() => {
          const v = videoRef.current;
          if (v) {
            v.pause();
            v.currentTime = 0;
          }
        }}
      >
        {p.image_url && !imgFailed ? (
          <img
            src={p.image_url}
            alt=""
            className={`h-full w-full object-cover transition duration-300 ${
              playable ? "group-hover:opacity-0" : "group-hover:scale-[1.03]"
            }`}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[#121820] text-xs text-white/40">
            Sin foto
          </div>
        )}
        {playable && p.video_url ? (
          <video
            ref={videoRef}
            src={p.video_url}
            muted
            playsInline
            loop
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition group-hover:opacity-100"
            onError={(e) => {
              (e.currentTarget as HTMLVideoElement).style.display = "none";
            }}
          />
        ) : null}
        {p.badge && (
          <span className="absolute left-2 top-2 rounded bg-black px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
            {p.badge}
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-white/90 sm:text-[14px]">{p.name}</h3>
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <p className="text-base font-bold text-white sm:text-lg">{formatPrice(p.price as number)}</p>
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-400">
            <Star className="h-[11px] w-[11px] fill-amber-400 text-amber-400" />
            <span>{rating.toFixed(1)}</span>
          </div>
        </div>
        <Link
          to="/store/$token/chat"
          params={{ token }}
          search={{ productId: p.id, productName: p.name }}
          className="mt-2 flex h-9 w-full items-center justify-center rounded-[14px] text-xs font-semibold text-white transition active:scale-[0.98]"
          style={{ background: "var(--store-accent)" }}
        >
          Ver detalles
        </Link>
      </div>
    </div>
  );
}
