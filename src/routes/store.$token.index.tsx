import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchStoreProducts, formatPrice, type StoreProduct } from "@/lib/store-client";
import { MessageCircle, Search, Star, X } from "lucide-react";

export const Route = createFileRoute("/store/$token/")({
  component: StoreHome,
});

function StoreHome() {
  const { token } = useParams({ from: "/store/$token/" });
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      fetchStoreProducts(token, { q: q.trim() || undefined })
        .then((list) => {
          if (!cancelled) {
            setProducts(list);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [token, q]);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-28 pt-5">
      {/* Barra búsqueda estilo Sincro */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-white/45">
            Catálogo público
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Explora y consulta
          </h1>
        </div>
        <div className="relative w-full max-w-lg sm:ml-auto">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            placeholder="Buscar…"
            className="h-10 w-full rounded-full border border-white/15 bg-white/10 py-2 pl-10 pr-9 text-sm text-white caret-white shadow-inner outline-none placeholder:text-white/50 transition hover:bg-white/15 focus:border-[color:var(--store-primary)]/40 focus:bg-white/15 focus:ring-1 focus:ring-[color:var(--store-primary)]/50 [&::-webkit-search-cancel-button]:hidden"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
              aria-label="Limpiar"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[3/4] animate-pulse rounded-2xl border border-white/5 bg-white/5"
            />
          ))}
        </div>
      )}

      {!loading && products.length === 0 && (
        <p className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-sm text-white/50">
          No hay productos activos. Sincroniza el catálogo Sincro en el CRM (Integración Catálogo).
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:gap-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} token={token} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => navigate({ to: "/store/$token/chat", params: { token } })}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 active:scale-[0.98]"
        style={{
          background: "#25D366",
          boxShadow: "0 8px 28px rgba(37, 211, 102, 0.35)",
        }}
      >
        <MessageCircle className="h-4 w-4" />
        WhatsApp / Chat
      </button>
    </main>
  );
}

function ProductCard({ product: p, token }: { product: StoreProduct; token: string }) {
  const rating = 4.5 + ((p.id?.charCodeAt(0) || 0) % 5) * 0.1;
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
      <Link
        to="/store/$token/product/$productId"
        params={{ token, productId: p.id }}
        className="relative block aspect-square overflow-hidden bg-black/30"
      >
        {p.image_url ? (
          <img
            src={p.image_url}
            alt=""
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-white/40">Sin foto</div>
        )}
        {p.badge && (
          <span
            className="absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
            style={{ background: "var(--store-primary)" }}
          >
            {p.badge}
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-snug tracking-tight text-white/90 sm:text-[14px]">
          {p.name}
        </h3>
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <p className="text-base font-bold tracking-tight text-white sm:text-lg">
            {formatPrice(p.price as number)}
          </p>
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]">
            <Star className="h-[11px] w-[11px] fill-amber-400 text-amber-400" />
            <span>{rating.toFixed(1)}</span>
          </div>
        </div>
        <Link
          to="/store/$token/product/$productId"
          params={{ token, productId: p.id }}
          className="mt-2 flex h-9 w-full items-center justify-center rounded-[14px] text-xs font-semibold text-white shadow-sm transition active:scale-[0.98]"
          style={{ background: "var(--store-primary)" }}
        >
          Ver detalles
        </Link>
      </div>
    </div>
  );
}
