import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  listStoreCatalogProducts,
  updateProductAiObservation,
} from "@/lib/catalog-products.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Search, Package } from "lucide-react";

export const Route = createFileRoute("/_authenticated/catalog")({
  component: CatalogProductsPage,
});

type CatalogRow = {
  id: string;
  name: string;
  description?: string | null;
  price?: number | null;
  stock?: number | null;
  image_url?: string | null;
  video_url?: string | null;
  sku?: string | null;
  badge?: string | null;
  category?: string | null;
  is_active?: boolean | null;
  ai_observation?: string | null;
};

function formatCop(price: number | null | undefined) {
  if (price == null || Number.isNaN(Number(price))) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(price));
}

function CatalogProductsPage() {
  const listFn = useServerFn(listStoreCatalogProducts);
  const updateFn = useServerFn(updateProductAiObservation);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [observation, setObservation] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["storeCatalogProducts", search],
    queryFn: () => listFn({ data: { q: search || undefined, limit: 60 } }),
  });

  const products = (data?.products ?? []) as CatalogRow[];
  const selected = useMemo(
    () => products.find((p) => p.id === selectedId) || null,
    [products, selectedId],
  );

  const mut = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          productId: selectedId!,
          ai_observation: observation.trim() || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storeCatalogProducts"] });
      toast.success("Observación guardada para la IA");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function selectProduct(p: CatalogRow) {
    setSelectedId(p.id);
    setObservation(p.ai_observation || "");
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Observaciones / prompts por producto</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Elige un producto y escribe cómo quieres que la IA lo atienda (tono, descuentos, objeciones,
          datos especiales). Eso se usa cuando el cliente abre el chat de ese producto.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, SKU o categoría…"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="max-h-[70vh] overflow-y-auto rounded-lg border bg-card">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Cargando productos…</p>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <Package className="h-8 w-8 opacity-40" />
              <p>No hay productos. Sincroniza desde Integración Catálogo.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {products.map((p) => {
                const active = p.id === selectedId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => selectProduct(p)}
                      className={`flex w-full gap-3 px-3 py-3 text-left transition hover:bg-muted/50 ${
                        active ? "bg-muted" : ""
                      }`}
                    >
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                            Sin foto
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatCop(p.price)}
                          {p.sku ? ` · ${p.sku}` : ""}
                          {p.category ? ` · ${p.category}` : ""}
                        </p>
                        {p.ai_observation ? (
                          <p className="mt-1 line-clamp-1 text-[11px] text-amber-700 dark:text-amber-400">
                            Obs. IA: {p.ai_observation}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {data?.total != null ? (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              {products.length} de {data.total} productos
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border bg-card p-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">
              Selecciona un producto para ver su ficha y editar la observación para la IA.
            </p>
          ) : (
            <div className="space-y-4">
              {selected.image_url ? (
                <img
                  src={selected.image_url}
                  alt=""
                  className="h-40 w-full rounded-md object-cover"
                />
              ) : null}
              <div>
                <h2 className="text-lg font-semibold leading-snug">{selected.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {formatCop(selected.price)}
                  {selected.sku ? ` · SKU ${selected.sku}` : ""}
                </p>
              </div>
              {selected.description ? (
                <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                  {selected.description}
                </p>
              ) : null}
              {selected.video_url ? (
                <p className="text-xs">
                  Video:{" "}
                  <a
                    href={selected.video_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    ver
                  </a>
                </p>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="ai-obs">Observación para la IA</Label>
                <Textarea
                  id="ai-obs"
                  value={observation}
                  onChange={(e) => setObservation(e.target.value)}
                  rows={6}
                  placeholder="Ej: Insistir en garantía de 1 año. Si preguntan por envío a Bogotá, decir que es gratis. No ofrecer descuento sin autorización…"
                />
                <p className="text-[11px] text-muted-foreground">
                  Cuando el cliente abra este producto en el chat, la IA recibirá esta instrucción
                  junto con precio, imagen y ficha.
                </p>
              </div>

              <Button
                type="button"
                disabled={!selectedId || mut.isPending}
                onClick={() => mut.mutate()}
              >
                {mut.isPending ? "Guardando…" : "Guardar observación"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
