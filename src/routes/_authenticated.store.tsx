import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getStoreSettings, updateStoreSettings } from "@/lib/store.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Copy, ExternalLink, Tags } from "lucide-react";

export const Route = createFileRoute("/_authenticated/store")({
  component: StoreSettingsPage,
});

function StoreSettingsPage() {
  const getFn = useServerFn(getStoreSettings);
  const updateFn = useServerFn(updateStoreSettings);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["storeSettings"],
    queryFn: () => getFn({}),
  });

  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("#0056AD");
  const [accent, setAccent] = useState("#FF2D95");
  const [logo, setLogo] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [socialTitle, setSocialTitle] = useState("");
  const [socialDesc, setSocialDesc] = useState("");
  const [socialImage, setSocialImage] = useState("");

  useEffect(() => {
    if (!data) return;
    setBrand(data.brand_name || "");
    setColor(data.primary_color || "#0056AD");
    setAccent((data as any).accent_color || "#FF2D95");
    setLogo(data.logo_url || "");
    setEnabled(data.enabled !== false);
    setSocialTitle((data as any).social_title || "");
    setSocialDesc((data as any).social_description || "");
    setSocialImage((data as any).social_image_url || "");
  }, [data]);

  const mut = useMutation({
    mutationFn: (vars: Record<string, unknown>) => updateFn({ data: vars as any }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["storeSettings"] });
      if (res?._warning) toast.warning(res._warning);
      else toast.success("Tienda actualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-muted-foreground">Cargando tienda…</div>;
  }

  const storeUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/store/${data.store_token}`
      : `/store/${data.store_token}`;

  const saveAll = () =>
    mut.mutate({
      brand_name: brand,
      primary_color: color,
      accent_color: accent,
      logo_url: logo.trim() || null,
      social_title: socialTitle.trim() || null,
      social_description: socialDesc.trim() || null,
      social_image_url: socialImage.trim() || null,
      enabled,
    });

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tienda web</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Catálogo público estilo Syncro. Comparte el link con tus clientes.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <Label>Link público</Label>
        <div className="flex gap-2">
          <Input readOnly value={storeUrl} className="font-mono text-xs" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => {
              navigator.clipboard.writeText(storeUrl);
              toast.success("Copiado");
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" asChild>
            <a href={storeUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
        <p className="break-all text-xs text-muted-foreground">Token: {data.store_token}</p>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <Tags className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-medium">Observaciones IA por producto</p>
            <p className="text-xs text-muted-foreground">
              Edita el prompt especial con el que la IA atiende cada producto del chat.
            </p>
          </div>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to="/catalog">Abrir</Link>
        </Button>
      </div>

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Logo y marca</h2>
        <div className="space-y-2">
          <Label>Nombre de marca</Label>
          <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Logo de la tienda (URL)</Label>
          <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…" />
          {logo.trim() ? (
            <img
              src={logo.trim()}
              alt="Logo"
              className="mt-2 h-16 w-16 rounded-xl object-cover ring-1 ring-border"
            />
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Color primario</Label>
            <div className="flex gap-2">
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-14 p-1" />
              <Input value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Color acento (botones)</Label>
            <div className="flex gap-2">
              <Input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="w-14 p-1" />
              <Input value={accent} onChange={(e) => setAccent(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Label>Tienda activa</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Personalización Social (Open Graph)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Cómo se ve el link al compartirlo en WhatsApp, Facebook o Instagram.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Título social</Label>
          <Input
            value={socialTitle}
            onChange={(e) => setSocialTitle(e.target.value)}
            placeholder={brand || "Título al compartir"}
          />
        </div>
        <div className="space-y-2">
          <Label>Descripción social</Label>
          <Textarea
            value={socialDesc}
            onChange={(e) => setSocialDesc(e.target.value)}
            placeholder="Descripción corta del catálogo…"
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label>Imagen social (URL)</Label>
          <Input
            value={socialImage}
            onChange={(e) => setSocialImage(e.target.value)}
            placeholder="https://… (1200×630 recomendado)"
          />
          {socialImage.trim() ? (
            <img
              src={socialImage.trim()}
              alt="OG preview"
              className="mt-2 max-h-32 w-full rounded-lg object-cover ring-1 ring-border"
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={saveAll} disabled={mut.isPending}>
          Guardar
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            if (confirm("¿Rotar token? El link anterior dejará de funcionar.")) {
              mut.mutate({ rotate_token: true });
            }
          }}
        >
          Rotar token
        </Button>
      </div>
    </div>
  );
}
