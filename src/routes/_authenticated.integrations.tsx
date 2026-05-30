import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getAiConfig, saveAiConfig, testAiReply } from "@/lib/ai.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Sparkles, CheckCircle2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/integrations")({
  component: IntegrationsPage,
});

const LOVABLE_MODELS = [
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (rápido)" },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (más barato)" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (más preciso)" },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
  { id: "openai/gpt-5-mini", label: "GPT-5 mini" },
  { id: "openai/gpt-5", label: "GPT-5" },
];

const VERTEX_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash-001",
  "gemini-1.5-pro-002",
];

function IntegrationsPage() {
  const qc = useQueryClient();
  const fetchCfg = useServerFn(getAiConfig);
  const save = useServerFn(saveAiConfig);
  const test = useServerFn(testAiReply);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-config"],
    queryFn: () => fetchCfg(),
  });

  const [form, setForm] = useState<any>(null);
  const [testInput, setTestInput] = useState("Hola, ¿qué productos tienen?");
  const [testOut, setTestOut] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.config && !form) setForm(data.config);
  }, [data, form]);

  if (isLoading || !form) {
    return <div className="p-8 text-muted-foreground">Cargando…</div>;
  }

  const update = (patch: any) => setForm({ ...form, ...patch });

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({
        data: {
          enabled: !!form.enabled,
          provider: form.provider,
          model: form.model,
          system_prompt: form.system_prompt ?? "",
          knowledge_base: form.knowledge_base ?? "",
          respond_to: form.respond_to,
          vertex_project: form.vertex_project ?? null,
          vertex_location: form.vertex_location ?? "us-central1",
          vertex_model: form.vertex_model ?? "gemini-2.5-flash",
        },
      });
      toast.success("Configuración guardada");
      qc.invalidateQueries({ queryKey: ["ai-config"] });
    } catch (e: any) {
      toast.error(e.message ?? "Error guardando");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestOut("");
    try {
      const r = await test({ data: { message: testInput } });
      setTestOut(r.reply);
    } catch (e: any) {
      setTestOut("Error: " + (e.message ?? "desconocido"));
    } finally {
      setTesting(false);
    }
  };

  const vertexReady = !!data?.hasVertexSecret;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Integraciones IA</h1>
          <p className="text-sm text-muted-foreground">
            Conecta una IA para responder automáticamente los mensajes entrantes.
          </p>
        </div>
      </div>

      <Card className="p-5 flex items-center justify-between">
        <div>
          <div className="font-semibold">Respuestas automáticas con IA</div>
          <div className="text-sm text-muted-foreground">
            Cuando esté activo, la IA responderá los mensajes entrantes según tu configuración.
          </div>
        </div>
        <Switch checked={form.enabled} onCheckedChange={(v) => update({ enabled: v })} />
      </Card>

      <Tabs
        value={form.provider}
        onValueChange={(v) => update({ provider: v })}
      >
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="lovable">
            Lovable AI
            <Badge variant="secondary" className="ml-2">listo</Badge>
          </TabsTrigger>
          <TabsTrigger value="vertex">
            Vertex AI
            {vertexReady ? (
              <Badge variant="secondary" className="ml-2">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                listo
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-2">
                <AlertCircle className="h-3 w-3 mr-1" />
                falta
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lovable" className="space-y-3 mt-4">
          <Card className="p-5 space-y-3">
            <div className="text-sm text-muted-foreground">
              Usa los modelos Gemini/GPT a través de Lovable AI Gateway. No requiere
              configuración adicional.
            </div>
            <div>
              <Label>Modelo</Label>
              <Select value={form.model} onValueChange={(v) => update({ model: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOVABLE_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="vertex" className="space-y-3 mt-4">
          <Card className="p-5 space-y-3">
            {!vertexReady && (
              <div className="rounded-md border border-orange-500/40 bg-orange-500/10 p-3 text-sm">
                Para usar Vertex AI necesitas configurar el secreto{" "}
                <code className="font-mono">VERTEX_SERVICE_ACCOUNT_JSON</code> con el JSON
                de una cuenta de servicio de Google Cloud con rol{" "}
                <code>Vertex AI User</code>. Pídeselo a Lovable para añadirlo a tu proyecto.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>GCP Project ID</Label>
                <Input
                  value={form.vertex_project ?? ""}
                  onChange={(e) => update({ vertex_project: e.target.value })}
                  placeholder="mi-proyecto-123"
                />
              </div>
              <div>
                <Label>Location</Label>
                <Input
                  value={form.vertex_location ?? "us-central1"}
                  onChange={(e) => update({ vertex_location: e.target.value })}
                  placeholder="us-central1"
                />
              </div>
            </div>
            <div>
              <Label>Modelo Vertex</Label>
              <Select
                value={form.vertex_model ?? "gemini-2.5-flash"}
                onValueChange={(v) => update({ vertex_model: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VERTEX_MODELS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="p-5 space-y-3">
        <div>
          <Label>Prompt del sistema (personalidad e instrucciones)</Label>
          <Textarea
            rows={5}
            value={form.system_prompt}
            onChange={(e) => update({ system_prompt: e.target.value })}
            placeholder="Eres el asistente de ventas de Acme. Responde con tono cercano…"
          />
        </div>
        <div>
          <Label>Base de conocimiento de productos / FAQ</Label>
          <Textarea
            rows={10}
            value={form.knowledge_base}
            onChange={(e) => update({ knowledge_base: e.target.value })}
            placeholder={`Producto: Plan Pro\nPrecio: $29/mes\n...\n\nPreguntas frecuentes:\n- ¿Hay envío gratis? Sí, en pedidos > $50.`}
            className="font-mono text-xs"
          />
          <div className="text-xs text-muted-foreground mt-1">
            Toda esta información se inyecta al prompt en cada respuesta.
          </div>
        </div>
        <div>
          <Label>Responder a</Label>
          <Select value={form.respond_to} onValueChange={(v) => update({ respond_to: v })}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los chats</SelectItem>
              <SelectItem value="new">Solo contactos nuevos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : "Guardar configuración"}
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="font-semibold">Probar respuesta</div>
        <Textarea
          rows={2}
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
        />
        <Button onClick={handleTest} disabled={testing} variant="secondary">
          {testing ? "Generando…" : "Generar respuesta de prueba"}
        </Button>
        {testOut && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
            {testOut}
          </div>
        )}
      </Card>
    </div>
  );
}
