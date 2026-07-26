import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchStoreProducts, formatPrice, type StoreProduct } from "@/lib/store-client";
import { Search } from "lucide-react";

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
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-6">
      <section className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-orange-500 via-rose-500 to-amber-600 px-5 py-8 text-white shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/80">Catálogo</p>
        <h1
          className="mt-2 text-3xl font-bold leading-tight sm:text-4xl"
          style={{ fontFamily: "Fraunces, Georgia, serif" }}
        >
          Elige y chatea para comprar
        </h1>
        <p className="mt-2 max-w-md text-sm text-white/90">
          Mira productos y pregunta por precio, ciudad o pedido en el chat — como en WhatsApp.
        </p>
      </section>

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar productos…"
          className="w-full rounded-full border border-stone-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none ring-orange-400 focus:ring-2"
        />
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-stone-200/80" />
          ))}
        </div>
      )}

      {!loading && products.length === 0 && (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white/60 p-8 text-center text-sm text-stone-500">
          No hay productos activos. Sincroniza el catálogo en el CRM.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {products.map((p) => (
          <Link
            key={p.id}
            to="/store/$token/product/$productId"
            params={{ token, productId: p.id }}
            className="group overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200/80 transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="relative aspect-square bg-stone-100">
              {p.image_url ? (
                <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-stone-400">Sin foto</div>
              )}
              {p.badge && (
                <span className="absolute left-2 top-2 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                  {p.badge}
                </span>
              )}
            </div>
            <div className="p-2.5">
              <p className="line-clamp-2 text-xs font-medium text-stone-800">{p.name}</p>
              <p className="mt-1 text-sm font-bold text-orange-600">{formatPrice(p.price as number)}</p>
            </div>
          </Link>
        ))}
      </div>

      <button
        type="button"
        onClick={() => navigate({ to: "/store/$token/chat", params: { token } })}
        className="fixed bottom-5 right-5 z-40 rounded-full bg-[#25D366] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20"
      >
        Abrir chat
      </button>
    </main>
  );
}
