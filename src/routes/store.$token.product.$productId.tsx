import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchStoreProducts, formatPrice, type StoreProduct } from "@/lib/store-client";
import { MessageCircle, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/store/$token/product/$productId")({
  component: ProductPage,
});

function ProductPage() {
  const { token, productId } = useParams({ from: "/store/$token/product/$productId" });
  const navigate = useNavigate();
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStoreProducts(token, { id: productId })
      .then((res) => setProduct(res.products[0] || null))
      .catch((e) => setError(e.message));
  }, [token, productId]);

  if (error) {
    return <p className="p-6 text-sm text-rose-300">{error}</p>;
  }
  if (!product) {
    return (
      <div className="flex justify-center py-20">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--store-primary)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 pb-28 pt-4">
      <Link
        to="/store/$token"
        params={{ token }}
        className="mb-3 inline-flex items-center gap-1 text-sm text-white/60 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Volver al catálogo
      </Link>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 shadow-lg">
        <div className="aspect-square bg-black/40">
          {product.image_url ? (
            <img src={product.image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-white/40">Sin imagen</div>
          )}
        </div>
        <div className="p-4 sm:p-5">
          {product.badge && (
            <span
              className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
              style={{ background: "var(--store-primary)" }}
            >
              {product.badge}
            </span>
          )}
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">{product.name}</h1>
          <p className="mt-1 text-xl font-bold" style={{ color: "var(--store-accent)" }}>
            {formatPrice(product.price as number)}
          </p>
          {product.category && (
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-white/40">{product.category}</p>
          )}
          {product.description && (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/65">
              {product.description}
            </p>
          )}
          {product.video_url && (
            <video
              src={product.video_url}
              controls
              playsInline
              className="mt-4 w-full rounded-xl border border-white/10"
              poster={product.image_url || undefined}
            />
          )}
          {product.sku && <p className="mt-2 text-xs text-white/40">SKU: {product.sku}</p>}
          {product.stock != null && (
            <p className="mt-1 text-xs text-white/40">
              Stock: {Number(product.stock) > 0 ? product.stock : "Consultar"}
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          navigate({
            to: "/store/$token/chat",
            params: { token },
            search: { productId: product.id, productName: product.name },
          })
        }
        className="fixed bottom-5 left-4 right-4 z-40 mx-auto flex max-w-lg items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold text-white shadow-lg transition hover:brightness-110 active:scale-[0.98]"
        style={{
          background: "#25D366",
          boxShadow: "0 8px 28px rgba(37, 211, 102, 0.35)",
        }}
      >
        <MessageCircle className="h-5 w-5" />
        Chatear / preguntar por este producto
      </button>
    </main>
  );
}
