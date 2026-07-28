import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getStoreSettings, updateStoreSettings } from "@/lib/store.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";

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
  const [logo, setLogo] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!data) return;
    setBrand(data.brand_name || "");
    setColor(data.primary_color || "#0056AD");
    setLogo(data.logo_url || "");
    setEnabled(data.enabled !== false);
  }, [data]);

  const mut = useMutation({
    mutationFn: (vars: Record<string, unknown>) => updateFn({ data: vars as any }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storeSettings"] });
      toast.success("Tienda actualizada");
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

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tienda web</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Catálogo público estilo Syncro (fondo oscuro + chat). Comparte el link con tus clientes.
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

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="space-y-2">
          <Label>Nombre de marca</Label>
          <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Color primario</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-14 p-1"
            />
            <Input value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Logo URL (opcional)</Label>
          <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…" />
        </div>
        <div className="flex items-center justify-between">
          <Label>Tienda activa</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              mut.mutate({
                brand_name: brand,
                primary_color: color,
                logo_url: logo.trim() || null,
                enabled,
              })
            }
            disabled={mut.isPending}
          >
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
    </div>
  );
}
