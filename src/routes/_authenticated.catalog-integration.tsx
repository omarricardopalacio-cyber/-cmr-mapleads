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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, XCircle, AlertCircle, ExternalLink } from "lucide-react";

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
    tenants_table: "tenants",
    products_table: "master_products",
  });

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    productCount?: number;
    sample?: Array<{ id: string; name: string; price?: any }>;
  } | null>(null);

  useEffect(() => {
    if (data?.config) {
      setForm({
        enabled: !!data.config.enabled,
        base_url: data.config.base_url ?? "",
        catalog_slug: data.config.catalog_slug ?? "",
        api_token: data.config.api_token ?? "",
        send_media: data.config.send_media ?? true,
        tenants_table: data.config.tenants_table ?? "tenants",
        products_table: data.config.products_table ?? "master_products",
      });
    }
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: form });
      toast.success("Configuración guardada");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await saveFn({ data: form }); // guardar primero
      const r = await testFn({});
      setTestResult(r);
      if (r.ok) toast.success("Catálogo conectado ✓");
      else toast.error("Falló: " + r.message);
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setTesting(false);
    }
  };

  const lastOk = data?.config?.last_test_ok;
  const lastAt = data?.config?.last_test_at;
  const lastMsg = data?.config?.last_test_message;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Integración con Catálogo Externo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conecta tu plataforma de catálogo (Supabase) para que la IA busque productos,
          envíe imágenes, precios y cierre ventas por WhatsApp en tiempo real.
        </p>
      </div>

      {/* Status badge */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <CardTitle className="text-base">Estado de conexión</CardTitle>
          <div className="flex items-center gap-2">
            {lastOk === true ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : lastOk === false ? (
              <XCircle className="h-4 w-4 text-red-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-yellow-500" />
            )}
            <span className="text-sm font-medium">
              {lastOk === true ? "Conectado" : lastOk === false ? "Sin conexión" : "Sin probar"}
            </span>
            {lastAt && (
              <span className="text-xs text-muted-foreground">
                · {new Date(lastAt).toLocaleString()}
              </span>
            )}
          </div>
        </CardHeader>
        {lastMsg && (
          <CardContent className="pt-0 pb-4">
            <p className="text-xs text-muted-foreground">{lastMsg}</p>
          </CardContent>
        )}
      </Card>

      {/* Config form */}
      <Card>
        <CardHeader>
          <CardTitle>Configuración</CardTitle>
          <CardDescription>
            Los datos los encuentras en tu plataforma de catálogo → Bodega → "Integración IA (CRM)".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Enable toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="font-medium">Activar integración</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                La IA usará search_catalog y send_product_to_customer cuando esté activa.
              </p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
          </div>

          {/* ① Supabase URL */}
          <div className="space-y-1.5">
            <Label>① URL de Supabase del catálogo</Label>
            <Input
              placeholder="https://xxxx.supabase.co"
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              La URL del <strong>proyecto Supabase</strong> de la plataforma de catálogo —{" "}
              <strong>NO</strong> es la URL de Netlify/catálogo web.
              Ej: <code>https://leqjedeupuikzjqlfzpx.supabase.co</code>
            </p>
          </div>

          {/* ② Publishable key */}
          <div className="space-y-1.5">
            <Label>② Publishable Key (anon key)</Label>
            <Input
              type="password"
              placeholder="sb_publishable_... o eyJhbGciOi..."
              value={form.api_token}
              onChange={(e) => setForm({ ...form, api_token: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              La anon/publishable key del proyecto Supabase del catálogo. La encuentras en el bloque
              "Integración IA (CRM)" de la página de la bodega.
            </p>
          </div>

          {/* ③ Slug */}
          <div className="space-y-1.5">
            <Label>③ Slug de la bodega / catálogo</Label>
            <Input
              placeholder="tv-market"
              value={form.catalog_slug}
              onChange={(e) => setForm({ ...form, catalog_slug: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              El slug tal como aparece en la URL del catálogo (ej: <code>sincro3.netlify.app/catalogo/<strong>tv-market</strong></code>).
            </p>
          </div>

          {/* Advanced: table names */}
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
              ▸ Configuración avanzada (nombres de tablas)
            </summary>
            <div className="mt-3 space-y-3 pl-2 border-l-2 border-muted">
              <div className="space-y-1.5">
                <Label>Tabla de tenants / bodegas</Label>
                <Input
                  placeholder="tenants"
                  value={form.tenants_table}
                  onChange={(e) => setForm({ ...form, tenants_table: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tabla de productos</Label>
                <Input
                  placeholder="master_products"
                  value={form.products_table}
                  onChange={(e) => setForm({ ...form, products_table: e.target.value })}
                />
              </div>
            </div>
          </details>

          {/* Send media toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="font-medium">Enviar imágenes de productos</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Si está desactivado, la IA solo envía texto (nombre, precio, enlace).
              </p>
            </div>
            <Switch checked={form.send_media} onCheckedChange={(v) => setForm({ ...form, send_media: v })} />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button onClick={save} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
            <Button variant="secondary" onClick={test} disabled={testing || saving}>
              {testing ? "Probando..." : "Probar conexión"}
            </Button>
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={
                "rounded-lg border p-4 text-sm space-y-2 " +
                (testResult.ok
                  ? "border-green-500/40 bg-green-500/10"
                  : "border-red-500/40 bg-red-500/10")
              }
            >
              <div className="flex items-center gap-2 font-medium">
                {testResult.ok ? (
                  <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                )}
                {testResult.message}
                {testResult.productCount !== undefined && (
                  <Badge variant="secondary">{testResult.productCount} productos</Badge>
                )}
              </div>
              {testResult.sample && testResult.sample.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-1 text-muted-foreground">Muestra:</p>
                  <ul className="text-xs space-y-0.5">
                    {testResult.sample.map((p) => (
                      <li key={p.id} className="font-mono">
                        [{p.id}] {p.name}
                        {p.price !== undefined ? ` — $${p.price}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">¿Cómo funciona?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              El CRM lee tu Supabase del catálogo <strong>directamente</strong> usando la anon key
              (PostgREST). No necesita endpoints intermedios.
            </li>
            <li>
              Cuando el cliente pregunta por un producto, la IA llama{" "}
              <code className="bg-muted px-1 py-0.5 rounded">search_catalog</code> → busca en{" "}
              <code className="bg-muted px-1 py-0.5 rounded">master_products</code> con{" "}
              <code className="bg-muted px-1 py-0.5 rounded">tenant_id</code> del slug.
            </li>
            <li>
              Si el cliente quiere ver el producto, la IA llama{" "}
              <code className="bg-muted px-1 py-0.5 rounded">send_product_to_customer</code> →
              envía imagen + precio + enlace por WhatsApp.
            </li>
          </ol>
          <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs">
            <strong>Requisito en el catálogo:</strong> La anon key debe tener{" "}
            <code>SELECT</code> sobre las tablas <code>tenants</code> y{" "}
            <code>master_products</code> vía RLS. El equipo del catálogo ya aplicó estos permisos.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
