// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  listCatalogIntegrations,
  saveCatalogIntegration,
  deleteCatalogIntegration,
  testCatalogIntegration,
  syncCatalogIntegration,
  catalogDiagnostic,
} from "@/lib/catalog.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ShoppingBag,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
  PackageSearch,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/catalog-integrations")({
  component: CatalogIntegrationsPage,
});

const EMPTY_FORM = {
  name: "",
  supabase_url: "",
  publishable_key: "",
  slug: "",
  tenants_table: "tenants",
  products_table: "master_products",
  is_active: true,
};

function StatusBadge({ status }: { status: string }) {
  if (status === "ok")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
        <CheckCircle2 className="h-3 w-3" /> OK
      </Badge>
    );
  if (status === "error")
    return (
      <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30 gap-1">
        <AlertCircle className="h-3 w-3" /> Error
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1">
      <Clock className="h-3 w-3" /> Pendiente
    </Badge>
  );
}

function CatalogIntegrationsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCatalogIntegrations);
  const saveFn = useServerFn(saveCatalogIntegration);
  const deleteFn = useServerFn(deleteCatalogIntegration);
  const testFn = useServerFn(testCatalogIntegration);
  const syncFn = useServerFn(syncCatalogIntegration);
  const diagFn = useServerFn(catalogDiagnostic);

  const { data: diagData } = useQuery({
    queryKey: ["catalog-diag"],
    queryFn: () => diagFn({}),
    refetchInterval: 30000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["catalog-integrations"],
    queryFn: () => listFn({}),
    refetchInterval: 15000,
  });

  const integrations = data?.integrations ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY_FORM });
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const updateForm = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  const openNew = () => {
    setForm({ ...EMPTY_FORM });
    setTestResult(null);
    setDialogOpen(true);
  };

  const openEdit = (integ: any) => {
    setForm({
      id: integ.id,
      name: integ.name,
      supabase_url: integ.supabase_url,
      publishable_key: integ.publishable_key,
      slug: integ.slug,
      tenants_table: integ.tenants_table,
      products_table: integ.products_table,
      is_active: integ.is_active,
    });
    setTestResult(null);
    setDialogOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: () => saveFn({ data: form }),
    onSuccess: () => {
      toast.success("Integración guardada");
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["catalog-integrations"] });
      qc.invalidateQueries({ queryKey: ["catalog-diag"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleTest = async () => {
    if (!form.id) {
      toast.error("Guarda la integración primero para poder probarla");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testFn({ data: { id: form.id } });
      setTestResult(r);
      qc.invalidateQueries({ queryKey: ["catalog-integrations"] });
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      const r: any = await syncFn({ data: { id } });
      toast.success(`Sincronizado: ${r.synced} productos`);
      qc.invalidateQueries({ queryKey: ["catalog-integrations"] });
      qc.invalidateQueries({ queryKey: ["catalog-diag"] });
    } catch (e: any) {
      toast.error("Error al sincronizar: " + e.message);
    } finally {
      setSyncingId(null);
    }
  };

  const handleTestFromList = async (id: string) => {
    setSyncingId(id + "_test");
    try {
      const r: any = await testFn({ data: { id } });
      if (r.ok) {
        toast.success(`Conexión OK — ${r.productCount} productos`);
      } else {
        toast.error(`Error (${r.step}): ${r.error}`);
      }
      qc.invalidateQueries({ queryKey: ["catalog-integrations"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSyncingId(null);
    }
  };

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Integración eliminada");
      qc.invalidateQueries({ queryKey: ["catalog-integrations"] });
      qc.invalidateQueries({ queryKey: ["catalog-diag"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShoppingBag className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Catálogos Externos</h1>
            <p className="text-sm text-muted-foreground">
              Conecta catálogos de producto y la IA los consulta en tiempo real.
            </p>
          </div>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Nueva integración
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-primary">
              {diagData?.totalIntegrations ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Catálogos conectados</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-3xl font-bold text-emerald-400">
              {diagData?.totalProducts ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Productos sincronizados</div>
          </CardContent>
        </Card>
        <Card className="col-span-2 md:col-span-1">
          <CardContent className="pt-5 flex items-center gap-3">
            <PackageSearch className="h-8 w-8 text-violet-400" />
            <div>
              <div className="text-sm font-medium">IA conectada</div>
              <div className="text-xs text-muted-foreground">
                La IA busca en todos los productos activos
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista de integraciones */}
      {isLoading ? (
        <div className="text-muted-foreground text-sm">Cargando…</div>
      ) : integrations.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground space-y-3">
          <ShoppingBag className="h-12 w-12 mx-auto opacity-30" />
          <div className="font-medium">No hay catálogos conectados</div>
          <div className="text-sm">
            Crea tu primera integración con el botón "Nueva integración"
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {integrations.map((integ: any) => (
            <Card key={integ.id} className="p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{integ.name}</span>
                    <StatusBadge status={integ.status} />
                    {!integ.is_active && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Inactivo
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {integ.supabase_url} · slug: <b>{integ.slug}</b>
                  </div>
                  <div className="text-xs text-muted-foreground flex gap-4 flex-wrap">
                    {integ.last_synced_at && (
                      <span>
                        Última sync:{" "}
                        {new Date(integ.last_synced_at).toLocaleString("es", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    )}
                    {integ.last_sync_count > 0 && (
                      <span className="text-emerald-400 font-medium">
                        {integ.last_sync_count} productos
                      </span>
                    )}
                    {integ.last_sync_error && (
                      <span className="text-rose-400 truncate max-w-xs" title={integ.last_sync_error}>
                        ⚠ {integ.last_sync_error.slice(0, 80)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Botones de acción */}
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs"
                    disabled={syncingId === integ.id + "_test"}
                    onClick={() => handleTestFromList(integ.id)}
                  >
                    <Zap className="h-3.5 w-3.5 text-yellow-400" />
                    {syncingId === integ.id + "_test" ? "Probando…" : "Probar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs"
                    disabled={syncingId === integ.id}
                    onClick={() => handleSync(integ.id)}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 text-blue-400 ${syncingId === integ.id ? "animate-spin" : ""}`}
                    />
                    {syncingId === integ.id ? "Sincronizando…" : "Sincronizar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-xs"
                    onClick={() => openEdit(integ)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Editar
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar integración?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Se eliminarán también todos los productos sincronizados de "{integ.name}".
                          Esta acción no se puede deshacer.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMut.mutate(integ.id)}
                          className="bg-destructive hover:bg-destructive/80"
                        >
                          Eliminar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Instrucciones */}
      <Card className="p-5 border-dashed border-muted-foreground/30">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-muted-foreground">
            ¿Cómo funciona la integración?
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 text-xs text-muted-foreground space-y-1">
          <p>① La bodega o vendedor te proporciona: <b>URL de Supabase</b>, <b>Publishable Key (anon)</b> y <b>Slug</b> desde su plataforma de catálogos.</p>
          <p>② Haz clic en <b>Probar</b> para verificar la conexión (resuelve slug → tenant y cuenta productos).</p>
          <p>③ Haz clic en <b>Sincronizar</b> para traer todos los productos al CRM.</p>
          <p>④ La IA podrá consultar los productos automáticamente cuando un cliente pregunte por ellos.</p>
          <p className="text-amber-400 mt-2">⚠ La URL de Supabase es como <code>https://xxxx.supabase.co</code>, NO la URL de Netlify del catálogo web.</p>
        </CardContent>
      </Card>

      {/* Dialog crear/editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar integración" : "Nueva integración"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre del catálogo</Label>
              <Input
                value={form.name}
                onChange={(e) => updateForm({ name: e.target.value })}
                placeholder="TV Market, Bodega Norte…"
              />
            </div>
            <div>
              <Label>URL de Supabase del catálogo</Label>
              <Input
                value={form.supabase_url}
                onChange={(e) => updateForm({ supabase_url: e.target.value })}
                placeholder="https://xxxx.supabase.co"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Es la URL del proyecto Supabase del catálogo, <b>no</b> la URL de Netlify.
              </p>
            </div>
            <div>
              <Label>Publishable Key (anon key)</Label>
              <Input
                type="password"
                value={form.publishable_key}
                onChange={(e) => updateForm({ publishable_key: e.target.value })}
                placeholder="sb_publishable_... o eyJ..."
              />
            </div>
            <div>
              <Label>Slug del catálogo / bodega</Label>
              <Input
                value={form.slug}
                onChange={(e) => updateForm({ slug: e.target.value })}
                placeholder="tv-market"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tabla de tenants</Label>
                <Input
                  value={form.tenants_table}
                  onChange={(e) => updateForm({ tenants_table: e.target.value })}
                  placeholder="tenants"
                />
              </div>
              <div>
                <Label>Tabla de productos</Label>
                <Input
                  value={form.products_table}
                  onChange={(e) => updateForm({ products_table: e.target.value })}
                  placeholder="master_products"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => updateForm({ is_active: v })}
              />
              <Label>Integración activa</Label>
            </div>

            {/* Resultado del test */}
            {testResult && (
              <div
                className={`rounded-md border p-3 text-sm ${
                  testResult.ok
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-500/40 bg-rose-500/10 text-rose-300"
                }`}
              >
                {testResult.ok ? (
                  <>
                    ✅ Conexión OK — <b>{testResult.productCount}</b> productos encontrados
                    {testResult.tenant?.name && ` (${testResult.tenant.name})`}
                  </>
                ) : (
                  <>
                    ❌ Error en paso <b>{testResult.step}</b>: {testResult.error}
                    {testResult.hint && (
                      <div className="text-xs opacity-80 mt-1">{testResult.hint}</div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            {form.id && (
              <Button variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? "Probando…" : "Probar conexión"}
              </Button>
            )}
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !form.name || !form.supabase_url || !form.publishable_key || !form.slug}
            >
              {saveMut.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
