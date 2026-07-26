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
      .then((list) => setProduct(list[0] || null))
      .catch((e) => setError(e.message));
  }, [token, productId]);

  if (error) {
    return <p className="p-6 text-sm text-red-600">{error}</p>;
  }
  if (!product) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 pb-28 pt-4">
      <Link
        to="/store/$token"
        params={{ token }}
        className="mb-3 inline-flex items-center gap-1 text-sm text-stone-600"
      >
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200">
        <div className="aspect-square bg-stone-100">
          {product.image_url ? (
            <img src={product.image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-stone-400">Sin imagen</div>
          )}
        </div>
        <div className="p-4">
          {product.badge && (
            <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
              {product.badge}
            </span>
          )}
          <h1
            className="mt-2 text-2xl font-bold text-stone-900"
            style={{ fontFamily: "Fraunces, Georgia, serif" }}
          >
            {product.name}
          </h1>
          <p className="mt-1 text-xl font-bold text-orange-600">{formatPrice(product.price as number)}</p>
          {product.description && (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-600">
              {product.description}
            </p>
          )}
          {product.sku && <p className="mt-2 text-xs text-stone-400">SKU: {product.sku}</p>}
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
        className="fixed bottom-5 left-4 right-4 z-40 mx-auto flex max-w-lg items-center justify-center gap-2 rounded-full bg-[#25D366] py-3.5 text-sm font-bold text-white shadow-lg"
      >
        <MessageCircle className="h-5 w-5" />
        Chatear / preguntar por este producto
      </button>
    </main>
  );
}
