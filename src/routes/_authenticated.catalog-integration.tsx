// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getCatalogIntegration,
  saveCatalogIntegration,
  testCatalogIntegration,
} from "@/lib/catalog.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/catalog-integration")({
  component: CatalogIntegrationPage,
});

function CatalogIntegrationPage() {
  const getFn = useServerFn(getCatalogIntegration);
  const saveFn = useServerFn(saveCatalogIntegration);
  const testFn = useServerFn(testCatalogIntegration);

  const { data, refetch } = useQuery({
    queryKey: ["catalog-integration"],
    queryFn: () => getFn({}),
  });

  const [form, setForm] = useState({
    enabled: false,
    base_url: "",
    catalog_slug: "",
    api_token: "",
    send_media: true,
  });

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; sample?: any[] } | null>(null);

  useEffect(() => {
    if (data?.config) {
      setForm({
        enabled: !!data.config.enabled,
        base_url: data.config.base_url ?? "",
        catalog_slug: data.config.catalog_slug ?? "",
        api_token: data.config.api_token ?? "",
        send_media: data.config.send_media ?? true,
      });
    }
  }, [data]);

  const save = async () => {
    try {
      await saveFn({ data: form });
      toast.success("Configuración guardada");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al guardar");
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await saveFn({ data: form }); // guarda primero
      const r = await testFn({});
      setTestResult(r);
      if (r.ok) toast.success("Catálogo conectado");
      else toast.error("Falló: " + r.message);
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setTesting(false);
    }
  };

  const lastOk = data?.config?.last_test_ok;
  const lastAt = data?.config?.last_test_at;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integración con Catálogo</h1>
        <p className="text-sm text-muted-foreground">
          Conecta tu página de catálogo (proyecto externo) para que la IA pueda buscar productos,
          enviar imágenes, precios y vender por WhatsApp.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Estado</CardTitle>
          <div className="flex items-center gap-2">
            <span
              className={
                "h-2.5 w-2.5 rounded-full " +
                (lastOk === true ? "bg-green-500" : lastOk === false ? "bg-red-500" : "bg-yellow-500")
              }
            />
            <span className="text-sm">
              {lastOk === true ? "Conectado" : lastOk === false ? "Sin conexión" : "Sin probar"}
              {lastAt ? ` · ${new Date(lastAt).toLocaleString()}` : ""}
            </span>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuración</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Activar integración</Label>
              <p className="text-xs text-muted-foreground">
                Cuando está activa, la IA podrá usar las herramientas del catálogo.
              </p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
          </div>

          <div className="space-y-2">
            <Label>URL base del catálogo</Label>
            <Input
              placeholder="https://sincro3.netlify.app"
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Dominio donde está publicada tu página de catálogo.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Slug del catálogo / bodega</Label>
            <Input
              placeholder="bodega-central-demo"
              value={form.catalog_slug}
              onChange={(e) => setForm({ ...form, catalog_slug: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Identificador de la bodega tal como aparece en la URL del catálogo.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Token API (opcional)</Label>
            <Input
              type="password"
              placeholder="token compartido con el proyecto de catálogo"
              value={form.api_token}
              onChange={(e) => setForm({ ...form, api_token: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Permitir enviar imágenes</Label>
              <p className="text-xs text-muted-foreground">
                Si está desactivado, la IA solo enviará el nombre, precio y enlace del producto.
              </p>
            </div>
            <Switch checked={form.send_media} onCheckedChange={(v) => setForm({ ...form, send_media: v })} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={save}>Guardar</Button>
            <Button variant="secondary" onClick={test} disabled={testing}>
              {testing ? "Probando..." : "Probar conexión"}
            </Button>
          </div>

          {testResult && (
            <div
              className={
                "rounded border p-3 text-sm " +
                (testResult.ok ? "border-green-500/40 bg-green-500/10" : "border-red-500/40 bg-red-500/10")
              }
            >
              <div className="font-medium">{testResult.ok ? "OK" : "Error"}: {testResult.message}</div>
              {testResult.sample && testResult.sample.length > 0 && (
                <ul className="mt-2 text-xs space-y-1">
                  {testResult.sample.map((p: any) => (
                    <li key={p.id}>· {p.id} — {p.name}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>¿Cómo lo usa la IA?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>Con la integración activa, la IA recibe dos herramientas:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><b>search_catalog</b>: busca productos por palabra clave.</li>
            <li><b>send_product_to_customer</b>: envía al cliente la ficha con imagen, precio y enlace.</li>
          </ul>
          <p className="text-muted-foreground">
            Endpoints requeridos en el proyecto de catálogo: <code className="ml-1">GET /api/public/catalog/{`{slug}`}/health</code>, <code className="ml-1">/search?q=&amp;limit=</code>, <code className="ml-1">/product/{`{id}`}</code>.
          </p>
          <p>Ver <code>CATALOG_INTEGRATION_MANUAL.md</code> para que la IA del proyecto de catálogo implemente esos endpoints.</p>
        </CardContent>
      </Card>
    </div>
  );
}
