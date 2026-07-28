import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  listStoreCatalogProducts,
  updateStoreProduct,
  uploadProductImage,
} from "@/lib/catalog-products.functions";
import {
  DEFAULT_FLOW_FIELD_ORDER,
  FLOW_FIELD_LABELS,
  clampFlowDelaySec,
  isFlowFieldEnabled,
  normalizeFlowFieldDelays,
  normalizeFlowFieldOrder,
  type FlowFieldId,
} from "@/lib/product-chat-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Search, Package, Pencil, Plus, Trash2, Upload, ChevronUp, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/catalog")({
  component: CatalogProductsPage,
});

type ChatFlowFlags = {
  send_specs?: boolean;
  send_ask?: boolean;
  send_price?: boolean;
  send_stock?: boolean;
  send_sku?: boolean;
  send_badge?: boolean;
  send_category?: boolean;
  send_image?: boolean;
  send_video?: boolean;
  send_description?: boolean;
  send_gallery?: boolean;
  field_order?: FlowFieldId[];
  field_delays?: Record<string, number>;
};

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
  chat_flow?: ChatFlowFlags | null;
};

function formatCop(price: number | null | undefined) {
  if (price == null || Number.isNaN(Number(price))) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(price));
}

function parseGallery(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((u): u is string => typeof u === "string" && !!u.trim())
      .map((u) => u.trim());
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      return parseGallery(JSON.parse(raw));
    } catch {
      if (raw.startsWith("http")) return [raw.trim()];
    }
  }
  return [];
}

const PAGE = 40;

function CatalogProductsPage() {
  const listFn = useServerFn(listStoreCatalogProducts);
  const updateFn = useServerFn(updateStoreProduct);
  const uploadFn = useServerFn(uploadProductImage);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const galleryFileRef = useRef<HTMLInputElement>(null);
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
    send_price: true,
    send_stock: true,
    send_sku: true,
    send_badge: true,
    send_category: true,
    send_image: false,
    send_video: false,
    send_description: false,
    send_gallery: false,
    field_order: [...DEFAULT_FLOW_FIELD_ORDER] as FlowFieldId[],
    field_delays: {} as Record<string, number>,
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
    const flow = p.chat_flow || {};
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
      gallery_images: parseGallery(p.gallery_images),
      send_specs: flow.send_specs !== false,
      send_ask: flow.send_ask !== false,
      send_price: flow.send_price !== false,
      send_stock: flow.send_stock !== false,
      send_sku: flow.send_sku !== false,
      send_badge: flow.send_badge !== false,
      send_category: flow.send_category !== false,
      send_image: flow.send_image === true,
      send_video: flow.send_video === true,
      send_description: flow.send_description === true,
      send_gallery: flow.send_gallery === true,
      field_order: normalizeFlowFieldOrder(flow.field_order),
      field_delays: normalizeFlowFieldDelays(flow.field_delays),
      newGalleryUrl: "",
    });
  }

  async function onGalleryFile(file: File | null) {
    if (!file || !selectedId) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Solo imágenes");
      return;
    }
    setUploadingGallery(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const contentBase64 = btoa(binary);
      const res = await uploadFn({
        data: {
          productId: selectedId,
          fileName: file.name,
          contentBase64,
          contentType: file.type || "image/jpeg",
        },
      });
      if (res?.url) {
        setForm((f) => ({
          ...f,
          gallery_images: [...f.gallery_images, res.url].slice(0, 12),
        }));
        toast.success("Imagen agregada a la galería");
      }
    } catch (e: any) {
      toast.error(e?.message || "No se pudo subir la imagen");
    } finally {
      setUploadingGallery(false);
      if (galleryFileRef.current) galleryFileRef.current.value = "";
    }
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
          chat_flow: {
            send_specs: form.send_specs,
            send_ask: form.send_ask,
            send_price: form.send_price,
            send_stock: form.send_stock,
            send_sku: form.send_sku,
            send_badge: form.send_badge,
            send_category: form.send_category,
            send_image: form.send_image,
            send_video: form.send_video,
            send_description: form.send_description,
            send_gallery: form.send_gallery,
            field_order: form.field_order,
            field_delays: form.field_delays,
          },
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

  const flowFlags = {
    send_price: form.send_price,
    send_stock: form.send_stock,
    send_sku: form.send_sku,
    send_badge: form.send_badge,
    send_category: form.send_category,
    send_image: form.send_image,
    send_video: form.send_video,
    send_description: form.send_description,
    send_gallery: form.send_gallery,
  };

  function setFlowFieldEnabled(id: FlowFieldId, enabled: boolean) {
    if (id === "name") return;
    const map: Record<Exclude<FlowFieldId, "name">, keyof typeof form> = {
      badge: "send_badge",
      category: "send_category",
      price: "send_price",
      sku: "send_sku",
      stock: "send_stock",
      image: "send_image",
      video: "send_video",
      description: "send_description",
      gallery: "send_gallery",
    };
    setForm({ ...form, [map[id]]: enabled });
  }

  function moveFlowField(from: number, to: number) {
    if (to < 1 || to >= form.field_order.length) return; // 0 = name fixed
    if (from < 1) return;
    const next = [...form.field_order];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    setForm({ ...form, field_order: normalizeFlowFieldOrder(next) });
  }

  function moveGallery(from: number, to: number) {
    if (to < 0 || to >= form.gallery_images.length) return;
    const next = [...form.gallery_images];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    setForm({ ...form, gallery_images: next });
  }

  const orderedPreviewLabels = form.field_order
    .filter((id) => isFlowFieldEnabled(flowFlags, id))
    .map((id) => {
      const d = form.field_delays[id] ?? 0;
      return d > 0 ? `${FLOW_FIELD_LABELS[id]} (+${d}s)` : FLOW_FIELD_LABELS[id];
    });

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
                      <li>Media fija arriba (imagen/video + galería con flechas)</li>
                      {selected.chat_flow?.send_specs !== false ? (
                        <li>
                          Ficha (
                          {normalizeFlowFieldOrder(selected.chat_flow?.field_order)
                            .filter((id) =>
                              isFlowFieldEnabled(
                                (selected.chat_flow || {}) as Record<string, unknown>,
                                id,
                              ),
                            )
                            .map((id) => FLOW_FIELD_LABELS[id])
                            .join(" → ") || "Nombre"}
                          )
                        </li>
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
                    {parseGallery(selected.gallery_images).length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {parseGallery(selected.gallery_images).map((url, i) => (
                          <img
                            key={`${url}-${i}`}
                            src={url}
                            alt=""
                            className="h-14 w-14 rounded object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.opacity = "0.3";
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
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
                    <p className="text-[11px] text-muted-foreground">
                      Activa cada dato y usa ↑↓ para definir el{" "}
                      <span className="font-semibold text-foreground">orden de envío</span>. Cada
                      campo se envía como mensaje aparte; imagen/video/galería van como media (no
                      como URL de texto).
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="send-specs">Enviar ficha</Label>
                      <Switch
                        id="send-specs"
                        checked={form.send_specs}
                        onCheckedChange={(v) => setForm({ ...form, send_specs: v })}
                      />
                    </div>
                    {form.send_specs ? (
                      <ul className="space-y-1.5 rounded border bg-muted/20 p-2">
                        <li className="px-1 pb-1 text-[10px] text-muted-foreground">
                          Columna “Espera (s)” = segundos a esperar <span className="font-medium">después</span>{" "}
                          de ese mensaje antes del siguiente (ej. Nombre 30 → Descripción). Máx. 600.
                        </li>
                        {form.field_order.map((id, i) => {
                          const enabled = isFlowFieldEnabled(flowFlags, id);
                          const locked = id === "name";
                          const delayVal = form.field_delays[id] ?? 0;
                          return (
                            <li
                              key={id}
                              className={`flex flex-wrap items-center gap-2 rounded border bg-background/60 px-2 py-1.5 ${
                                enabled ? "" : "opacity-55"
                              }`}
                            >
                              <span className="w-5 shrink-0 text-center text-[11px] font-semibold text-muted-foreground">
                                {i + 1}
                              </span>
                              <div className="flex shrink-0 flex-col">
                                <button
                                  type="button"
                                  className="rounded p-0.5 hover:bg-muted disabled:opacity-25"
                                  disabled={locked || i <= 1}
                                  aria-label="Subir en el orden"
                                  onClick={() => moveFlowField(i, i - 1)}
                                >
                                  <ChevronUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="rounded p-0.5 hover:bg-muted disabled:opacity-25"
                                  disabled={locked || i >= form.field_order.length - 1}
                                  aria-label="Bajar en el orden"
                                  onClick={() => moveFlowField(i, i + 1)}
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <Label
                                htmlFor={`flow-field-${id}`}
                                className="min-w-0 flex-1 text-sm leading-tight"
                              >
                                {FLOW_FIELD_LABELS[id]}
                              </Label>
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  max={600}
                                  step={1}
                                  title="Segundos de espera después de este mensaje"
                                  className="h-8 w-16 px-1 text-center text-xs"
                                  value={delayVal}
                                  disabled={!enabled}
                                  onChange={(e) =>
                                    setForm({
                                      ...form,
                                      field_delays: {
                                        ...form.field_delays,
                                        [id]: clampFlowDelaySec(e.target.value),
                                      },
                                    })
                                  }
                                />
                                <span className="text-[10px] text-muted-foreground">s</span>
                              </div>
                              <Switch
                                id={`flow-field-${id}`}
                                checked={enabled}
                                disabled={locked}
                                onCheckedChange={(v) => setFlowFieldEnabled(id, v)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
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
                      Orden de envío:{" "}
                      <span className="text-foreground">
                        {form.send_specs
                          ? orderedPreviewLabels.join(" → ") || "Nombre"
                          : "(sin ficha)"}
                      </span>
                      {form.send_ask ? ` → “${askPreview}”` : ""}
                    </div>
                  </div>

                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Label>Imágenes extra (galería)</Label>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Orden = orden en el chat (flechas del carrusel). Sube archivo o pega URL.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Label htmlFor="send-gallery-flow" className="text-xs whitespace-nowrap">
                          Enviar en el flujo
                        </Label>
                        <Switch
                          id="send-gallery-flow"
                          checked={form.send_gallery}
                          onCheckedChange={(v) => setForm({ ...form, send_gallery: v })}
                        />
                      </div>
                    </div>
                    {form.send_gallery ? (
                      <p className="rounded bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                        Cada imagen de la galería se enviará como mensaje con la foto (en este orden).
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        Las imágenes se ven con las flechas del chat; actívalas en el flujo para
                        enviarlas también como mensajes.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={galleryFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void onGalleryFile(e.target.files?.[0] || null)}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={uploadingGallery || !selectedId}
                        className="gap-1.5"
                        onClick={() => galleryFileRef.current?.click()}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {uploadingGallery ? "Subiendo…" : "Subir imagen"}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={form.newGalleryUrl}
                        onChange={(e) => setForm({ ...form, newGalleryUrl: e.target.value })}
                        placeholder="https://… URL de imagen"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        onClick={() => {
                          const u = form.newGalleryUrl.trim();
                          if (!u) return;
                          if (!/^https?:\/\//i.test(u)) {
                            toast.error("La URL debe empezar por http:// o https://");
                            return;
                          }
                          setForm({
                            ...form,
                            gallery_images: [...form.gallery_images, u].slice(0, 12),
                            newGalleryUrl: "",
                          });
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {form.gallery_images.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">Sin imágenes en galería.</p>
                    ) : (
                      <ul className="space-y-2">
                        {form.gallery_images.map((url, i) => (
                          <li
                            key={`${url}-${i}`}
                            className="flex items-center gap-2 rounded border bg-muted/20 p-1.5"
                          >
                            <span className="flex h-8 w-6 shrink-0 items-center justify-center text-[11px] font-semibold text-muted-foreground">
                              {i + 1}
                            </span>
                            <img
                              src={url}
                              alt=""
                              className="h-12 w-12 shrink-0 rounded object-cover bg-muted"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.opacity = "0.25";
                              }}
                            />
                            <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                              {url}
                            </span>
                            <div className="flex shrink-0 flex-col gap-0.5">
                              <button
                                type="button"
                                className="rounded p-1 hover:bg-muted disabled:opacity-30"
                                disabled={i === 0}
                                aria-label="Subir"
                                onClick={() => moveGallery(i, i - 1)}
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="rounded p-1 hover:bg-muted disabled:opacity-30"
                                disabled={i === form.gallery_images.length - 1}
                                aria-label="Bajar"
                                onClick={() => moveGallery(i, i + 1)}
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <button
                              type="button"
                              className="rounded p-1.5 text-rose-500 hover:bg-rose-500/10"
                              aria-label="Quitar"
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
                    )}
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
