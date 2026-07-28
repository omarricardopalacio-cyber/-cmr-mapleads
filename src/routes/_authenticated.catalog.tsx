import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  listStoreCatalogProducts,
  updateStoreProduct,
} from "@/lib/catalog-products.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Search, Package, Pencil, Plus, Trash2 } from "lucide-react";

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
  chat_ask_text?: string | null;
  gallery_images?: string[] | null;
  chat_flow?: { send_specs?: boolean; send_ask?: boolean } | null;
};

function formatCop(price: number | null | undefined) {
  if (price == null || Number.isNaN(Number(price))) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(price));
}

const PAGE = 40;

function CatalogProductsPage() {
  const listFn = useServerFn(listStoreCatalogProducts);
  const updateFn = useServerFn(updateStoreProduct);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    stock: "",
    image_url: "",
    video_url: "",
    sku: "",
    badge: "",
    category: "",
    ai_observation: "",
    chat_ask_text: "",
    gallery_images: [] as string[],
    send_specs: true,
    send_ask: true,
    newGalleryUrl: "",
  });

  const query = useInfiniteQuery({
    queryKey: ["storeCatalogProducts", search],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      listFn({ data: { q: search || undefined, limit: PAGE, offset: pageParam } }),
    getNextPageParam: (last) => {
      if (!last?.hasMore) return undefined;
      return (last.offset || 0) + (last.products?.length || 0);
    },
  });

  const products = useMemo(
    () => (query.data?.pages.flatMap((p) => (p.products || []) as CatalogRow[]) ?? []) as CatalogRow[],
    [query.data],
  );
  const selected = useMemo(
    () => products.find((p) => p.id === selectedId) || null,
    [products, selectedId],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  function selectProduct(p: CatalogRow) {
    setSelectedId(p.id);
    setEditing(false);
    setForm({
      name: p.name || "",
      description: p.description || "",
      price: p.price != null ? String(p.price) : "",
      stock: p.stock != null ? String(p.stock) : "",
      image_url: p.image_url || "",
      video_url: p.video_url || "",
      sku: p.sku || "",
      badge: p.badge || "",
      category: p.category || "",
      ai_observation: p.ai_observation || "",
      chat_ask_text: p.chat_ask_text || "",
      gallery_images: Array.isArray(p.gallery_images) ? [...p.gallery_images] : [],
      send_specs: p.chat_flow?.send_specs !== false,
      send_ask: p.chat_flow?.send_ask !== false,
      newGalleryUrl: "",
    });
  }

  const mut = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          productId: selectedId!,
          name: form.name.trim(),
          description: form.description.trim() || null,
          price: form.price.trim() === "" ? null : Number(form.price),
          stock: form.stock.trim() === "" ? null : Number(form.stock),
          image_url: form.image_url.trim() || null,
          video_url: form.video_url.trim() || null,
          sku: form.sku.trim() || null,
          badge: form.badge.trim() || null,
          category: form.category.trim() || null,
          ai_observation: form.ai_observation.trim() || null,
          chat_ask_text: form.chat_ask_text.trim() || null,
          gallery_images: form.gallery_images,
          chat_flow: { send_specs: form.send_specs, send_ask: form.send_ask },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storeCatalogProducts"] });
      toast.success("Producto actualizado");
      setEditing(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const askPreview =
    form.chat_ask_text.trim() || "¿Dime qué te gustaría saber del producto?";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Observaciones / prompts por producto</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Edita ficha, imagen, video, observación IA y el flujo automático del chat. Scroll infinito en
          la lista.
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

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="max-h-[75vh] overflow-y-auto rounded-lg border bg-card">
          {query.isLoading ? (
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
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div ref={sentinelRef} className="px-3 py-3 text-center text-xs text-muted-foreground">
            {query.isFetchingNextPage
              ? "Cargando más…"
              : query.hasNextPage
                ? "Desplázate para ver más"
                : products.length
                  ? `${products.length} productos`
                  : null}
          </div>
        </div>

        <div className="max-h-[75vh] overflow-y-auto rounded-lg border bg-card p-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">
              Selecciona un producto para ver/editar ficha, media y flujo del chat.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold leading-snug">{selected.name}</h2>
                  <p className="text-sm text-muted-foreground">{formatCop(selected.price)}</p>
                </div>
                <Button
                  type="button"
                  variant={editing ? "secondary" : "default"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setEditing((v) => !v)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {editing ? "Cancelar" : "Editar todo"}
                </Button>
              </div>

              {!editing ? (
                <>
                  {selected.image_url ? (
                    <img
                      src={selected.image_url}
                      alt=""
                      className="h-40 w-full rounded-md object-cover"
                    />
                  ) : null}
                  {selected.video_url ? (
                    <video
                      src={selected.video_url}
                      controls
                      playsInline
                      className="max-h-48 w-full rounded-md bg-black"
                      poster={selected.image_url || undefined}
                    />
                  ) : null}
                  {selected.description ? (
                    <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                      {selected.description}
                    </p>
                  ) : null}
                  <div className="rounded-md border bg-muted/30 p-3 text-xs">
                    <p className="mb-2 font-semibold">Vista previa del flujo automático</p>
                    <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                      <li>Media fija arriba (imagen/video del producto)</li>
                      {selected.chat_flow?.send_specs !== false ? (
                        <li>Ficha: nombre, etiqueta, categoría, precio, stock</li>
                      ) : null}
                      {selected.chat_flow?.send_ask !== false ? (
                        <li>
                          Pregunta:{" "}
                          <span className="text-foreground">
                            {selected.chat_ask_text || "¿Dime qué te gustaría saber del producto?"}
                          </span>
                        </li>
                      ) : null}
                    </ol>
                  </div>
                  {selected.ai_observation ? (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                      <span className="font-semibold">Obs. IA:</span> {selected.ai_observation}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Nombre</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>Precio</Label>
                      <Input
                        value={form.price}
                        onChange={(e) => setForm({ ...form, price: e.target.value })}
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Stock</Label>
                      <Input
                        value={form.stock}
                        onChange={(e) => setForm({ ...form, stock: e.target.value })}
                        inputMode="numeric"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>SKU</Label>
                      <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label>Etiqueta</Label>
                      <Input
                        value={form.badge}
                        onChange={(e) => setForm({ ...form, badge: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Categoría</Label>
                    <Input
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>URL imagen principal</Label>
                    <Input
                      value={form.image_url}
                      onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>URL video</Label>
                    <Input
                      value={form.video_url}
                      onChange={(e) => setForm({ ...form, video_url: e.target.value })}
                      placeholder="https://...mp4 o Drive"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Descripción</Label>
                    <Textarea
                      rows={4}
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Observación para la IA</Label>
                    <Textarea
                      rows={4}
                      value={form.ai_observation}
                      onChange={(e) => setForm({ ...form, ai_observation: e.target.value })}
                      placeholder="Cómo debe atender la IA este producto…"
                    />
                  </div>

                  <div className="rounded-md border p-3 space-y-3">
                    <p className="text-sm font-semibold">Flujo automático del chat</p>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="send-specs">Enviar ficha (precio/stock)</Label>
                      <Switch
                        id="send-specs"
                        checked={form.send_specs}
                        onCheckedChange={(v) => setForm({ ...form, send_specs: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="send-ask">Enviar pregunta</Label>
                      <Switch
                        id="send-ask"
                        checked={form.send_ask}
                        onCheckedChange={(v) => setForm({ ...form, send_ask: v })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Texto de la pregunta</Label>
                      <Input
                        value={form.chat_ask_text}
                        onChange={(e) => setForm({ ...form, chat_ask_text: e.target.value })}
                        placeholder={askPreview}
                      />
                    </div>
                    <div className="rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
                      Vista previa: media arriba →{" "}
                      {form.send_specs ? "ficha → " : ""}
                      {form.send_ask ? `“${askPreview}”` : "(sin pregunta)"}
                    </div>
                  </div>

                  <div className="space-y-2 rounded-md border p-3">
                    <Label>Imágenes extra (galería)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={form.newGalleryUrl}
                        onChange={(e) => setForm({ ...form, newGalleryUrl: e.target.value })}
                        placeholder="URL de imagen…"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        onClick={() => {
                          const u = form.newGalleryUrl.trim();
                          if (!u) return;
                          setForm({
                            ...form,
                            gallery_images: [...form.gallery_images, u],
                            newGalleryUrl: "",
                          });
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <ul className="space-y-1">
                      {form.gallery_images.map((url, i) => (
                        <li key={`${url}-${i}`} className="flex items-center gap-2 text-xs">
                          <img src={url} alt="" className="h-8 w-8 rounded object-cover" />
                          <span className="min-w-0 flex-1 truncate">{url}</span>
                          <button
                            type="button"
                            className="text-rose-500"
                            onClick={() =>
                              setForm({
                                ...form,
                                gallery_images: form.gallery_images.filter((_, j) => j !== i),
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Button
                    type="button"
                    disabled={mut.isPending || !form.name.trim()}
                    onClick={() => mut.mutate()}
                    className="w-full"
                  >
                    {mut.isPending ? "Guardando…" : "Guardar cambios"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
