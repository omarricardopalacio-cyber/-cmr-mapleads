import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/** Compat: /product/:id redirige al chat con el producto enfocado. */
export const Route = createFileRoute("/store/$token/product/$productId")({
  component: ProductRedirectToChat,
});

function ProductRedirectToChat() {
  const { token, productId } = useParams({ from: "/store/$token/product/$productId" });
  const navigate = useNavigate();

  useEffect(() => {
    navigate({
      to: "/store/$token/chat",
      params: { token },
      search: { productId, productName: undefined },
      replace: true,
    });
  }, [token, productId, navigate]);

  return (
    <div className="flex justify-center py-20 text-sm text-white/60">Abriendo chat del producto…</div>
  );
}
