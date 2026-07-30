import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getWatcherConfig,
  saveWatcherConfig,
  listIntentRules,
  upsertIntentRule,
  deleteIntentRule,
  listAdSegments,
  upsertAdSegment,
  deleteAdSegment,
  scanAdSegmentsBatch,
  scanIntentFlowsBatch,
  scanInquiryBatch,
} from "@/lib/intent-watcher.functions";
import { listFlows } from "@/lib/flows.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Save, Trash2, Eye, Settings2, Target, Play, Loader2, Workflow, MessageSquareText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/intent-watcher")({
  component: IntentWatcherPage,
});

type IntentRule = {
  id: string;
  name: string;
  intent_key: string;
  description: string | null;
  match_type: "keywords" | "ai" | "both";
  keywords: string | null;
  trigger_on: "message" | "no_response" | "purchase" | "any";
  flow_id: string;
  priority: number;
  cooldown_seconds: number;
  is_active: boolean;
  flows?: { id: string; name: string } | { id: string; name: string }[] | null;
};

type AdSegment = {
  id: string;
  name: string;
  match_phrase: string;
  match_mode: "contains" | "equals" | "starts";
  flow_id: string | null;
  priority: number;
  is_active: boolean;
  observations?: string | null;
  ad_investment?: number | null;
  flows?: { id: string; name: string } | { id: string; name: string }[] | null;
  stats?: {
    contacts: number;
    messages_in: number;
    sales: number;
    cost_per_message: number | null;
    cost_per_sale: number | null;
    messages_per_sale: number | null;
  };
};

const emptyRule = (): Omit<IntentRule, "id"> & { id?: string } => ({
  name: "",
  intent_key: "",
  description: "",
  match_type: "both",
  keywords: "",
  trigger_on: "message",
  flow_id: "",
  priority: 100,
  cooldown_seconds: 300,
  is_active: true,
});

const emptySegment = (): Omit<AdSegment, "id"> & { id?: string } => ({
  name: "",
  match_phrase: "",
  match_mode: "contains",
  flow_id: null,
  priority: 100,
  is_active: true,
  observations: "",
  ad_investment: 0,
});

function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
}

function formatNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

const SUGGESTED = [
  { key: "precio_caro", label: "Precio caro / no me alcanza" },
  { key: "no_responde", label: "No responde (silencio)" },
  { key: "compro", label: "Compró / agendó pedido (estado Compró)" },
  { key: "pide_envio", label: "Pregunta por envío" },
  { key: "pide_info", label: "Pide información general" },
  { key: "objecion_confianza", label: "Desconfianza / estafa" },
];

function IntentWatcherPage() {
  const qc = useQueryClient();
  const getCfgFn = useServerFn(getWatcherConfig);
  const saveCfgFn = useServerFn(saveWatcherConfig);
  const listFn = useServerFn(listIntentRules);
  const listFlowsFn = useServerFn(listFlows);
  const listSegFn = useServerFn(listAdSegments);
  const scanSegFn = useServerFn(scanAdSegmentsBatch);
  const scanIntentFn = useServerFn(scanIntentFlowsBatch);
  const scanInquiryFn = useServerFn(scanInquiryBatch);

  const { data: cfgData } = useQuery({
    queryKey: ["watcherConfig"],
    queryFn: () => getCfgFn({}),
  });
  const { data: rulesData } = useQuery({
    queryKey: ["intentRules"],
    queryFn: () => listFn({}),
  });
  const { data: flowsData } = useQuery({
    queryKey: ["flows"],
    queryFn: () => listFlowsFn({}),
  });
  const { data: segData } = useQuery({
    queryKey: ["adSegments"],
    queryFn: () => listSegFn({}),
  });

  const [cfg, setCfg] = useState({
    enabled: false,
    grok_api_key: "",
    model: "llama-3.3-70b-versatile",
    extract_profile: true,
  });
  const [editing, setEditing] = useState<ReturnType<typeof emptyRule> | null>(null);
  const [editingSeg, setEditingSeg] = useState<ReturnType<typeof emptySegment> | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [scanningSeg, setScanningSeg] = useState(false);
  const [scanningIntent, setScanningIntent] = useState(false);
  const [scanningInquiry, setScanningInquiry] = useState(false);
  const [scanProgress, setScanProgress] = useState<string | null>(null);

  const anyScanning = scanningSeg || scanningIntent || scanningInquiry;

  async function runBatchScan(kind: "segments" | "intents" | "inquiry") {
    if (anyScanning) return;
    if (kind === "segments") setScanningSeg(true);
    else if (kind === "intents") setScanningIntent(true);
    else setScanningInquiry(true);

    let offset = 0;
    let totalScanned = 0;
    let totalApplied = 0;
    let totalSkipped = 0;
    let totalProducts = 0;
    let totalQuestions = 0;
    const samples: string[] = [];

    try {
      for (let i = 0; i < 50; i++) {
        const labelProgress =
          kind === "segments"
            ? "segmentos"
            : kind === "intents"
              ? "intenciones/flujos"
              : "productos/preguntas";
        setScanProgress(
          `Evaluando ${labelProgress}… revisados ${totalScanned}, actualizados ${totalApplied}`,
        );
        const fn =
          kind === "segments" ? scanSegFn : kind === "intents" ? scanIntentFn : scanInquiryFn;
        const res = (await fn({ data: { limit: 40, offset } })) as {
          scanned: number;
          applied: number;
          skipped: number;
          done: boolean;
          nextOffset: number;
          samples?: string[];
          productsAdded?: number;
          questionsAdded?: number;
        };
        totalScanned += res.scanned || 0;
        totalApplied += res.applied || 0;
        totalSkipped += res.skipped || 0;
        totalProducts += res.productsAdded || 0;
        totalQuestions += res.questionsAdded || 0;
        if (res.samples?.length) samples.push(...res.samples.slice(0, 3));
        offset = res.nextOffset;
        if (res.done || (res.scanned || 0) === 0) break;
      }

      const label =
        kind === "segments"
          ? "Segmentos"
          : kind === "intents"
            ? "Intenciones/flujos"
            : "Productos/preguntas";
      const extra =
        kind === "inquiry"
          ? ` · +${totalProducts} productos · +${totalQuestions} preguntas`
          : "";
      toast.success(
        `${label}: ${totalApplied} actualizados · ${totalSkipped} omitidos · ${totalScanned} revisados${extra}`,
      );
      if (samples.length) {
        toast.message(samples.slice(0, 5).join(" · "));
      }
      qc.invalidateQueries({ queryKey: ["adSegments"] });
      qc.invalidateQueries({ queryKey: ["intentRules"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    } catch (e: any) {
      toast.error(e?.message || "Error en el barrido del vigilante");
    } finally {
      setScanningSeg(false);
      setScanningIntent(false);
      setScanningInquiry(false);
      setScanProgress(null);
    }
  }

  useEffect(() => {
    const c = cfgData?.config as any;
    if (!c) return;
    setCfg({
      enabled: !!c.enabled,
      grok_api_key: c.grok_api_key || "",
      model: c.model || "llama-3.3-70b-versatile",
      extract_profile: c.extract_profile !== false,
    });
  }, [cfgData]);

  const rules = (rulesData?.items ?? []) as IntentRule[];
  const segments = (segData?.items ?? []) as AdSegment[];
  const flows = (flowsData?.flows ?? []) as { id: string; name: string; is_active?: boolean }[];

  async function saveConfig() {
    setSavingCfg(true);
    try {
      await saveCfgFn({ data: cfg });
      toast.success("Configuración del vigilante guardada");
      qc.invalidateQueries({ queryKey: ["watcherConfig"] });
    } catch (e: any) {
      toast.error(e?.message || "No se pudo guardar");
    } finally {
      setSavingCfg(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Eye className="h-6 w-6" />
          Vigilante de segmentos y clasificador de flujos
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Segmenta leads de Facebook por frase/emoticon, detecta intenciones y asigna
          flujos. La ficha (ciudad, segmento, etc.) sale en el Excel de contactos.
        </p>
      </div>

      <Tabs defaultValue="segments">
        <TabsList>
          <TabsTrigger value="segments">Segmentos de entrada</TabsTrigger>
          <TabsTrigger value="intents">Intenciones → flujo</TabsTrigger>
          <TabsTrigger value="config">Configuración IA</TabsTrigger>
        </TabsList>

        <TabsContent value="segments" className="space-y-4 mt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-medium flex items-center gap-2">
                <Target className="h-5 w-5" /> Segmentos de publicidad
              </h2>
              <p className="text-xs text-muted-foreground">
                Cuando el cliente llega con una frase/emoticon del anuncio, el vigilante
                guarda el segmento en la ficha y en el Excel (solo la primera vez).
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button
                variant="secondary"
                disabled={anyScanning}
                onClick={() => void runBatchScan("segments")}
              >
                {scanningSeg ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                Evaluar segmentos
              </Button>
              <Button
                variant="secondary"
                disabled={anyScanning}
                onClick={() => void runBatchScan("intents")}
              >
                {scanningIntent ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Workflow className="h-4 w-4 mr-1" />
                )}
                Intenciones y flujos
              </Button>
              <Button
                variant="secondary"
                disabled={anyScanning}
                onClick={() => void runBatchScan("inquiry")}
              >
                {scanningInquiry ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <MessageSquareText className="h-4 w-4 mr-1" />
                )}
                Productos y preguntas
              </Button>
              <Button onClick={() => setEditingSeg(emptySegment())}>
                <Plus className="h-4 w-4 mr-1" /> Nuevo segmento
              </Button>
            </div>
          </div>

          {scanProgress ? (
            <Card className="p-3 text-xs text-muted-foreground border-dashed">
              {scanProgress}
              <span className="block mt-1 text-[10px]">
                Si ya tiene el dato, se omite y no se cuenta.
              </span>
            </Card>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              <b>Evaluar segmentos</b> marca publicidad.{" "}
              <b>Intenciones y flujos</b> asigna flujo si aún no lo tiene.{" "}
              <b>Productos y preguntas</b> rellena esas columnas del Excel/Contactos
              leyendo el historial (omite si ya están llenas).
            </p>
          )}

          {editingSeg && (
            <SegmentEditor
              segment={editingSeg}
              flows={flows}
              onClose={() => setEditingSeg(null)}
              onSaved={() => {
                setEditingSeg(null);
                qc.invalidateQueries({ queryKey: ["adSegments"] });
              }}
            />
          )}

          <div className="grid gap-3">
            {segments.map((s) => {
              const flowName = Array.isArray(s.flows) ? s.flows[0]?.name : s.flows?.name;
              const st = s.stats;
              return (
                <Card key={s.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium truncate">{s.name}</p>
                        <Badge
                          variant="default"
                          className="text-[10px] bg-violet-600 hover:bg-violet-600"
                          title="Contactos marcados con este segmento"
                        >
                          {st?.contacts ?? 0} registros
                        </Badge>
                        <Badge variant={s.is_active ? "default" : "secondary"} className="text-[10px]">
                          {s.is_active ? "Activo" : "Inactivo"}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {s.match_mode}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        Frase: “{s.match_phrase}”
                        {flowName ? ` · Flujo: ${flowName}` : " · Sin flujo"}
                        {` · Prioridad ${s.priority}`}
                        {s.ad_investment != null && Number(s.ad_investment) > 0
                          ? ` · Inversión ${formatMoney(Number(s.ad_investment))}`
                          : ""}
                      </p>
                      {s.observations ? (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          Obs: {s.observations}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => setEditingSeg({ ...s })}>
                        <Settings2 className="h-4 w-4" />
                      </Button>
                      <DeleteSegmentButton id={s.id} />
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-4">
                    <div className="rounded-md border bg-violet-500/10 border-violet-500/30 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Registros
                      </p>
                      <p className="text-sm font-semibold tabular-nums">
                        {st?.contacts ?? 0}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        contactos con este segmento
                      </p>
                    </div>
                    <div className="rounded-md border bg-muted/30 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Costo por mensaje
                      </p>
                      <p className="text-sm font-semibold tabular-nums">
                        {formatMoney(st?.cost_per_message)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {st?.messages_in ?? 0} msgs recibidos
                      </p>
                    </div>
                    <div className="rounded-md border bg-muted/30 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Costo por venta
                      </p>
                      <p className="text-sm font-semibold tabular-nums">
                        {formatMoney(st?.cost_per_sale)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {st?.sales ?? 0} ventas consolidadas
                      </p>
                    </div>
                    <div className="rounded-md border bg-muted/30 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Nº mensajes para venta
                      </p>
                      <p className="text-sm font-semibold tabular-nums">
                        {formatNum(st?.messages_per_sale)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        msgs ÷ ventas
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
            {segments.length === 0 && (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                Crea un segmento, ej. nombre <code>seg-bogota - zapatero</code> y frase{" "}
                <code>hola deseo zapateros :)</code>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="intents" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Parámetros de intención → flujo</h2>
              <p className="text-xs text-muted-foreground">
                Ej: si dice “está caro” → intención <code>precio_caro</code> → flujo de oferta.
              </p>
            </div>
            <Button onClick={() => setEditing(emptyRule())}>
              <Plus className="h-4 w-4 mr-1" /> Nueva intención
            </Button>
          </div>

          {editing && (
            <RuleEditor
              rule={editing}
              flows={flows}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                qc.invalidateQueries({ queryKey: ["intentRules"] });
              }}
            />
          )}

          <div className="grid gap-3">
            {rules.map((r) => {
              const flowName = Array.isArray(r.flows) ? r.flows[0]?.name : r.flows?.name;
              return (
                <Card key={r.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium truncate">{r.name}</p>
                      <Badge variant={r.is_active ? "default" : "secondary"} className="text-[10px]">
                        {r.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {r.intent_key}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {r.trigger_on}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      Flujo: {flowName || r.flow_id} · Prioridad {r.priority} ·{" "}
                      {r.match_type === "keywords"
                        ? "Solo keywords"
                        : r.match_type === "ai"
                          ? "Solo IA"
                          : "Keywords + IA"}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => setEditing({ ...r })}>
                      <Settings2 className="h-4 w-4" />
                    </Button>
                    <DeleteRuleButton id={r.id} />
                  </div>
                </Card>
              );
            })}
            {rules.length === 0 && (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                Aún no hay intenciones. Crea una (ej. precio_caro) y asígnale un flujo.
              </Card>
            )}
          </div>

          <Card className="p-4 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground text-sm">Sugerencias de claves</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED.map((s) => (
                <Badge key={s.key} variant="outline" className="font-normal">
                  {s.key} — {s.label}
                </Badge>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium flex items-center gap-2">
                  <Settings2 className="h-4 w-4" /> Configuración del vigilante (IA)
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  API Key de Groq distinta a la IA vendedora. Los segmentos se detectan
                  aunque la IA esté apagada; las intenciones requieren el switch Activo.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="w-enabled" className="text-xs">
                  Activo
                </Label>
                <Switch
                  id="w-enabled"
                  checked={cfg.enabled}
                  onCheckedChange={(v) => setCfg((s) => ({ ...s, enabled: v }))}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>API Key Groq del vigilante</Label>
                <Input
                  type="password"
                  value={cfg.grok_api_key}
                  onChange={(e) => setCfg((s) => ({ ...s, grok_api_key: e.target.value }))}
                  placeholder="gsk_..."
                />
              </div>
              <div>
                <Label>Modelo</Label>
                <Input
                  value={cfg.model}
                  onChange={(e) => setCfg((s) => ({ ...s, model: e.target.value }))}
                />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch
                  checked={cfg.extract_profile}
                  onCheckedChange={(v) => setCfg((s) => ({ ...s, extract_profile: v }))}
                />
                <Label className="text-xs leading-tight">
                  Extraer ficha (nombre, ciudad, dirección, barrio)
                </Label>
              </div>
            </div>
            <Button onClick={saveConfig} disabled={savingCfg}>
              <Save className="h-4 w-4 mr-1" /> Guardar configuración
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DeleteRuleButton({ id }: { id: string }) {
  const qc = useQueryClient();
  const delFn = useServerFn(deleteIntentRule);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        if (!confirm("¿Eliminar esta intención?")) return;
        try {
          await delFn({ data: { id } });
          toast.success("Eliminada");
          qc.invalidateQueries({ queryKey: ["intentRules"] });
        } catch (e: any) {
          toast.error(e?.message || "Error");
        }
      }}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}

function DeleteSegmentButton({ id }: { id: string }) {
  const qc = useQueryClient();
  const delFn = useServerFn(deleteAdSegment);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        if (!confirm("¿Eliminar este segmento?")) return;
        try {
          await delFn({ data: { id } });
          toast.success("Segmento eliminado");
          qc.invalidateQueries({ queryKey: ["adSegments"] });
        } catch (e: any) {
          toast.error(e?.message || "Error");
        }
      }}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}

function SegmentEditor({
  segment,
  flows,
  onClose,
  onSaved,
}: {
  segment: ReturnType<typeof emptySegment> & { id?: string; stats?: AdSegment["stats"] };
  flows: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const upsertFn = useServerFn(upsertAdSegment);
  const [form, setForm] = useState({ ...segment });
  const [saving, setSaving] = useState(false);

  const previewInv = Number(form.ad_investment) || 0;
  const msgs = segment.stats?.messages_in ?? 0;
  const sales = segment.stats?.sales ?? 0;
  const preview = {
    cost_per_message: msgs > 0 ? previewInv / msgs : null,
    cost_per_sale: sales > 0 ? previewInv / sales : null,
    messages_per_sale: sales > 0 ? msgs / sales : null,
  };

  async function save() {
    if (!form.name.trim() || !form.match_phrase.trim()) {
      toast.error("Nombre y frase/parámetro son obligatorios");
      return;
    }
    setSaving(true);
    try {
      await upsertFn({
        data: {
          id: form.id,
          name: form.name.trim(),
          match_phrase: form.match_phrase.trim(),
          match_mode: form.match_mode,
          flow_id: form.flow_id || null,
          priority: Number(form.priority) || 100,
          is_active: !!form.is_active,
          observations: form.observations || null,
          ad_investment: Number(form.ad_investment) || 0,
        },
      });
      toast.success("Segmento guardado");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5 space-y-3 border-primary/30">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          {form.id ? "Editar segmento" : "Nuevo segmento"}
        </h3>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Activo</Label>
          <Switch
            checked={!!form.is_active}
            onCheckedChange={(v) => setForm((s) => ({ ...s, is_active: v }))}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Nombre del segmento</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            placeholder="seg-bogota - zapatero"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Frase / parámetro / emoticon</Label>
          <Input
            value={form.match_phrase}
            onChange={(e) => setForm((s) => ({ ...s, match_phrase: e.target.value }))}
            placeholder="hola deseo zapateros :)"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Debe coincidir con el mensaje con el que llegan desde el anuncio de Facebook.
          </p>
        </div>
        <div>
          <Label>Tipo de coincidencia</Label>
          <Select
            value={form.match_mode}
            onValueChange={(v) => setForm((s) => ({ ...s, match_mode: v as any }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contains">Contiene</SelectItem>
              <SelectItem value="equals">Igual exacto</SelectItem>
              <SelectItem value="starts">Empieza con</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Prioridad</Label>
          <Input
            type="number"
            value={form.priority}
            onChange={(e) => setForm((s) => ({ ...s, priority: Number(e.target.value) }))}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Flujo opcional al detectar</Label>
          <Select
            value={form.flow_id || "__none__"}
            onValueChange={(v) =>
              setForm((s) => ({ ...s, flow_id: v === "__none__" ? null : v }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Sin flujo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin flujo</SelectItem>
              {flows.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Observaciones</Label>
          <Textarea
            rows={3}
            value={form.observations || ""}
            onChange={(e) => setForm((s) => ({ ...s, observations: e.target.value }))}
            placeholder="Anotaciones internas del segmento (campaña, público, creativo…)"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Inversión publicitaria</Label>
          <Input
            type="number"
            min={0}
            step="1000"
            value={form.ad_investment ?? 0}
            onChange={(e) =>
              setForm((s) => ({ ...s, ad_investment: Number(e.target.value) || 0 }))
            }
            placeholder="0"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Con este valor se calculan costo por mensaje, costo por venta y mensajes por venta.
          </p>
        </div>
        {form.id ? (
          <div className="sm:col-span-2 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Costo por mensaje
              </p>
              <p className="text-sm font-semibold">{formatMoney(preview.cost_per_message)}</p>
              <p className="text-[10px] text-muted-foreground">{msgs} msgs recibidos</p>
            </div>
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Costo por venta
              </p>
              <p className="text-sm font-semibold">{formatMoney(preview.cost_per_sale)}</p>
              <p className="text-[10px] text-muted-foreground">{sales} ventas</p>
            </div>
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Nº mensajes para venta
              </p>
              <p className="text-sm font-semibold">{formatNum(preview.messages_per_sale)}</p>
              <p className="text-[10px] text-muted-foreground">msgs ÷ ventas</p>
            </div>
          </div>
        ) : (
          <div className="sm:col-span-2 rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
            Guarda el segmento e indica la inversión para ver costo por mensaje, costo por venta y
            número de mensajes para venta (según leads de este segmento).
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={save} disabled={saving}>
          <Save className="h-4 w-4 mr-1" /> Guardar
        </Button>
      </div>
    </Card>
  );
}

function RuleEditor({
  rule,
  flows,
  onClose,
  onSaved,
}: {
  rule: ReturnType<typeof emptyRule> & { id?: string };
  flows: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const upsertFn = useServerFn(upsertIntentRule);
  const [form, setForm] = useState({ ...rule });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name.trim() || !form.intent_key.trim() || !form.flow_id) {
      toast.error("Nombre, clave y flujo son obligatorios");
      return;
    }
    setSaving(true);
    try {
      await upsertFn({
        data: {
          id: form.id,
          name: form.name.trim(),
          intent_key: form.intent_key.trim().toLowerCase(),
          description: form.description || null,
          match_type: form.match_type,
          keywords: form.keywords || null,
          trigger_on: form.trigger_on,
          flow_id: form.flow_id,
          priority: Number(form.priority) || 100,
          cooldown_seconds: Number(form.cooldown_seconds) || 0,
          is_active: !!form.is_active,
        },
      });
      toast.success("Intención guardada");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5 space-y-3 border-primary/30">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{form.id ? "Editar intención" : "Nueva intención"}</h3>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Activa</Label>
          <Switch
            checked={!!form.is_active}
            onCheckedChange={(v) => setForm((s) => ({ ...s, is_active: v }))}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Nombre</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            placeholder="Precio caro"
          />
        </div>
        <div>
          <Label>Clave (intent_key)</Label>
          <Input
            value={form.intent_key}
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                intent_key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
              }))
            }
            placeholder="precio_caro"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Descripción (para la IA vigilante)</Label>
          <Input
            value={form.description || ""}
            onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
            placeholder="Cliente dice que está caro o no le alcanza"
          />
        </div>
        <div>
          <Label>Cuándo se evalúa</Label>
          <Select
            value={form.trigger_on}
            onValueChange={(v) => setForm((s) => ({ ...s, trigger_on: v as any }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="message">Mensaje del cliente</SelectItem>
              <SelectItem value="no_response">No responde (silencio)</SelectItem>
              <SelectItem value="purchase">Cuando compra</SelectItem>
              <SelectItem value="any">Cualquiera</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Detección</Label>
          <Select
            value={form.match_type}
            onValueChange={(v) => setForm((s) => ({ ...s, match_type: v as any }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keywords">Solo palabras clave</SelectItem>
              <SelectItem value="ai">Solo IA vigilante</SelectItem>
              <SelectItem value="both">Keywords + IA</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Palabras clave (una por línea)</Label>
          <Textarea
            rows={3}
            value={form.keywords || ""}
            onChange={(e) => setForm((s) => ({ ...s, keywords: e.target.value }))}
            placeholder={"esta caro\nno me alcanza\nmuy caro\nno tengo plata"}
          />
        </div>
        <div>
          <Label>Flujo a ejecutar</Label>
          <Select
            value={form.flow_id || undefined}
            onValueChange={(v) => setForm((s) => ({ ...s, flow_id: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un flujo" />
            </SelectTrigger>
            <SelectContent>
              {flows.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Prioridad</Label>
            <Input
              type="number"
              value={form.priority}
              onChange={(e) => setForm((s) => ({ ...s, priority: Number(e.target.value) }))}
            />
          </div>
          <div>
            <Label>Cooldownoldown (seg)</Label>
            <Input
              type="number"
              value={form.cooldown_seconds}
              onChange={(e) =>
                setForm((s) => ({ ...s, cooldown_seconds: Number(e.target.value) }))
              }
            />
          </div>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={save} disabled={saving}>
          <Save className="h-4 w-4 mr-1" /> Guardar
        </Button>
      </div>
    </Card>
  );
}
