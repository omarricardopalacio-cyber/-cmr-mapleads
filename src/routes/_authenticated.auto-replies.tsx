import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  listAutoReplies,
  upsertAutoReply,
  deleteAutoReply,
} from "@/lib/automations.functions";
import { listTags } from "@/lib/tags.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, X, ChevronUp, ChevronDown, ImagePlus, Link2, Clock } from "lucide-react";
import { supabase as supabaseBrowser } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/auto-replies")({
  component: AutoRepliesPage,
});

function AutoRepliesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Auto-respuestas</h1>
      <AutoRepliesTab />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Cooldown Input — number + unit selector → maps to cooldown_seconds
// ══════════════════════════════════════════════════════════════════
type CooldownUnit = "seg" | "min" | "horas" | "días";

const UNIT_SECONDS: Record<CooldownUnit, number> = {
  seg: 1,
  min: 60,
  horas: 3600,
  días: 86400,
};

const MAX_COOLDOWN_SECONDS = 2592000; // 30 days

function toDisplayCooldown(seconds: number): { value: number; unit: CooldownUnit } {
  if (seconds === 0) return { value: 0, unit: "seg" };
  if (seconds % 86400 === 0 && seconds / 86400 <= 30) return { value: seconds / 86400, unit: "días" };
  if (seconds % 3600 === 0) return { value: seconds / 3600, unit: "horas" };
  if (seconds % 60 === 0) return { value: seconds / 60, unit: "min" };
  return { value: seconds, unit: "seg" };
}

function CooldownInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (seconds: number) => void;
}) {
  const display = toDisplayCooldown(value);
  const [num, setNum] = useState(display.value);
  const [unit, setUnit] = useState<CooldownUnit>(display.unit);

  useEffect(() => {
    const display = toDisplayCooldown(value);
    setNum(display.value);
    setUnit(display.unit);
  }, [value]);

  function update(n: number, u: CooldownUnit) {
    setNum(n);
    setUnit(u);
    const secs = Math.min(n * UNIT_SECONDS[u], MAX_COOLDOWN_SECONDS);
    onChange(secs);
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        min={0}
        max={unit === "días" ? 30 : unit === "horas" ? 720 : unit === "min" ? 43200 : MAX_COOLDOWN_SECONDS}
        value={num}
        onChange={(e) => update(Number(e.target.value), unit)}
        className="w-20 h-7 text-xs"
      />
      <Select value={unit} onValueChange={(u: CooldownUnit) => update(num, u)}>
        <SelectTrigger className="w-20 h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="seg">seg</SelectItem>
          <SelectItem value="min">min</SelectItem>
          <SelectItem value="horas">horas</SelectItem>
          <SelectItem value="días">días</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function formatCooldown(seconds: number): string {
  if (seconds === 0) return "0 seg";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join(" ");
}

// ══════════════════════════════════════════════════════════════════
// Step type
// ══════════════════════════════════════════════════════════════════
type Step = {
  cooldown_seconds: number;
  text_content: string;
  media_url: string;
  mime_type: string;
  /** UI-only: a signed URL for preview while editing */
  previewUrl?: string;
};

function emptyStep(): Step {
  return { cooldown_seconds: 0, text_content: "", media_url: "", mime_type: "", previewUrl: "" };
}

// ══════════════════════════════════════════════════════════════════
// Auto Replies Tab
// ══════════════════════════════════════════════════════════════════
function AutoRepliesTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAutoReplies);
  const upsert = useServerFn(upsertAutoReply);
  const del = useServerFn(deleteAutoReply);
  const tagsFn = useServerFn(listTags);

  const { data } = useQuery({ queryKey: ["autoReplies"], queryFn: () => listFn({}) });
  const { data: tagsData } = useQuery({ queryKey: ["tags"], queryFn: () => tagsFn({}) });
  const tags = tagsData?.tags ?? [];
  const rules = data?.rules ?? [];

  // ─── form state ───────────────────────────────────────────────
  const defaultForm = {
    id: undefined as string | undefined,
    name: "",
    trigger_type: "keyword" as "keyword" | "first_message_overall" | "first_message_month" | "no_response",
    match_type: "contains" as "contains" | "equals" | "starts" | "regex",
    match_value: "",
    is_active: true,
    session_id: null as string | null,
    action_add_tags: [] as string[],
    action_remove_tags: [] as string[],
    action_ai_behavior: "no_change" as "no_change" | "disable_ai" | "enable_ai",
    chain_to_rule_id: null as string | null,
    limit_per_contact: null as number | null,
    // no_response fields
    no_response_delay_seconds: 900 as number,
    no_response_ai_scope: "always" as "always" | "ai_active" | "ai_inactive",
    no_response_tag_id: null as string | null,
  };
  const [form, setForm] = useState(defaultForm);
  const [steps, setSteps] = useState<Step[]>([emptyStep()]);
  const [uploading, setUploading] = useState<Record<number, boolean>>({});

  function resetForm() {
    setForm(defaultForm);
    setSteps([emptyStep()]);
  }

  async function loadEdit(r: any) {
    setForm({
      id: r.id,
      name: r.name,
      trigger_type: r.trigger_type,
      match_type: r.match_type,
      match_value: r.match_value,
      is_active: r.is_active,
      session_id: r.session_id ?? null,
      action_add_tags: r.action_add_tags ?? [],
      action_remove_tags: r.action_remove_tags ?? [],
      action_ai_behavior: r.action_ai_behavior ?? "no_change",
      chain_to_rule_id: r.chain_to_rule_id ?? null,
      limit_per_contact: r.limit_per_contact ?? null,
      no_response_delay_seconds: r.no_response_delay_seconds ?? 900,
      no_response_ai_scope: r.no_response_ai_scope ?? "always",
      no_response_tag_id: r.no_response_tag_id ?? null,
    });
    const loaded: Step[] = await Promise.all((r.steps ?? []).map(async (s: any) => {
      let previewUrl = s.media_url ?? "";
      if (s.media_url) {
        const { data: signedData } = await supabaseBrowser.storage.from("auto-reply-media").createSignedUrl(s.media_url, 3600);
        if (signedData?.signedUrl) previewUrl = signedData.signedUrl;
      }
      return {
        cooldown_seconds: s.cooldown_seconds,
        text_content: s.text_content ?? "",
        media_url: s.media_url ?? "",
        mime_type: s.mime_type ?? "",
        previewUrl,
      };
    }));
    setSteps(loaded.length ? loaded : [emptyStep()]);
  }

  // ─── Step helpers ─────────────────────────────────────────────
  function updateStep(i: number, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addStep() {
    setSteps((prev) => [...prev, emptyStep()]);
  }
  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }
  function moveStep(i: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = i + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[i], next[target]] = [next[target], next[i]];
      return next;
    });
  }

  // ─── Image upload ─────────────────────────────────────────────
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  async function handleImageUpload(idx: number, file: File) {
    setUploading((p) => ({ ...p, [idx]: true }));
    try {
      const ext = file.name.split(".").pop();
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabaseBrowser.storage
        .from("auto-reply-media")
        .upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;

      const { data: signedData, error: signErr } = await supabaseBrowser.storage
        .from("auto-reply-media")
        .createSignedUrl(path, 3600);
      if (signErr) throw signErr;

      // Store permanent path (not signed URL) as media_url
      updateStep(idx, {
        media_url: path,
        mime_type: file.type,
        previewUrl: signedData.signedUrl,
      });
      toast.success("Imagen adjuntada");
    } catch (e: any) {
      toast.error("Error al subir imagen: " + e.message);
    } finally {
      setUploading((p) => ({ ...p, [idx]: false }));
    }
  }

  // ─── Submit ───────────────────────────────────────────────────
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const stepsPayload = steps.map((s) => ({
      cooldown_seconds: s.cooldown_seconds,
      text_content: s.text_content || null,
      media_url: s.media_url || null,
      mime_type: s.mime_type || null,
    }));

    const payload = {
      ...form,
      action_add_tags: form.action_add_tags.length ? form.action_add_tags : null,
      action_remove_tags: form.action_remove_tags.length ? form.action_remove_tags : null,
      steps: stepsPayload,
    };

    try {
      await upsert({ data: payload as any });
      toast.success("Regla guardada");
      resetForm();
      qc.invalidateQueries({ queryKey: ["autoReplies"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="grid md:grid-cols-2 gap-4 mt-4">
      {/* ── Form ── */}
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">{form.id ? "Editar regla" : "Nueva regla"}</h3>
        <form onSubmit={submit} className="space-y-3">
          <Input
            placeholder="Nombre"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />

          {/* Trigger type */}
          <Select
            value={form.trigger_type}
            onValueChange={(v: any) => setForm({ ...form, trigger_type: v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="keyword">Palabra clave</SelectItem>
              <SelectItem value="first_message_overall">Primer mensaje (global)</SelectItem>
              <SelectItem value="first_message_month">Primer mensaje del mes</SelectItem>
              <SelectItem value="no_response">⏱️ Sin respuesta del cliente</SelectItem>
            </SelectContent>
          </Select>

          {/* no_response: delay + AI scope + tag */}
          {form.trigger_type === "no_response" && (
            <div className="border rounded p-3 space-y-3 bg-amber-950/20 border-amber-800/40">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-400" />
                <span className="text-xs font-medium text-amber-300">Enviar si el cliente no responde en:</span>
              </div>
              <CooldownInput
                value={form.no_response_delay_seconds}
                onChange={(s) => setForm({ ...form, no_response_delay_seconds: s })}
              />
              <div className="space-y-1">
                <Label className="text-xs">¿Cuándo aplica?</Label>
                <Select
                  value={form.no_response_ai_scope}
                  onValueChange={(v: any) => setForm({ ...form, no_response_ai_scope: v })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">Siempre enviar</SelectItem>
                    <SelectItem value="ai_active">Solo si la IA está activa</SelectItem>
                    <SelectItem value="ai_inactive">Solo si la IA está inactiva</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {tags.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Etiquetar contacto si no responde (opcional)</Label>
                  <Select
                    value={form.no_response_tag_id ?? "none"}
                    onValueChange={(v) => setForm({ ...form, no_response_tag_id: v === "none" ? null : v })}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="Sin etiqueta" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin etiqueta</SelectItem>
                      {tags.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Match type + value */}
          {form.trigger_type === "keyword" && (
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={form.match_type}
                onValueChange={(v: any) => setForm({ ...form, match_type: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">Contiene</SelectItem>
                  <SelectItem value="equals">Igual a</SelectItem>
                  <SelectItem value="starts">Empieza con</SelectItem>
                  <SelectItem value="regex">Regex</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Patrón"
                value={form.match_value}
                onChange={(e) => setForm({ ...form, match_value: e.target.value })}
                required
              />
            </div>
          )}

          {/* ── Steps ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Secuencia de respuestas</Label>
              <span className="text-xs text-muted-foreground">Cada paso espera su cooldown antes de enviarse</span>
            </div>
            {steps.map((step, i) => (
              <div key={i} className="border rounded p-3 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Paso #{i + 1}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Cooldown:</span>
                    <CooldownInput
                      value={step.cooldown_seconds}
                      onChange={(s) => updateStep(i, { cooldown_seconds: s })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => moveStep(i, -1)}
                      disabled={i === 0}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => moveStep(i, 1)}
                      disabled={i === steps.length - 1}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    {steps.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive"
                        onClick={() => removeStep(i)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>

                <Textarea
                  placeholder="Mensaje de texto (opcional si hay imagen)"
                  value={step.text_content}
                  onChange={(e) => updateStep(i, { text_content: e.target.value })}
                  className="min-h-[72px] text-sm"
                />

                {/* Image/Video/Doc preview */}
                {step.previewUrl && (
                  <div className="relative w-20 h-20">
                    {step.mime_type?.startsWith("video/") ? (
                      <video src={step.previewUrl} className="w-20 h-20 object-cover rounded border" />
                    ) : step.mime_type?.startsWith("image/") || !step.mime_type ? (
                      <img src={step.previewUrl} alt="preview" className="w-20 h-20 object-cover rounded border" />
                    ) : (
                      <div className="w-20 h-20 flex items-center justify-center border rounded bg-muted text-xs text-center p-1">
                        Documento
                      </div>
                    )}
                    <button
                      type="button"
                      className="absolute -top-1 -right-1 bg-destructive text-white rounded-full w-4 h-4 flex items-center justify-center text-xs"
                      onClick={() => updateStep(i, { media_url: "", mime_type: "", previewUrl: "" })}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                )}

                {/* File upload button */}
                {!step.previewUrl && (
                  <>
                    <input
                      type="file"
                      accept="image/*,video/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="hidden"
                      ref={(el) => { fileInputRefs.current[i] = el; }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageUpload(i, file);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1"
                      disabled={uploading[i]}
                      onClick={() => fileInputRefs.current[i]?.click()}
                    >
                      <ImagePlus className="h-3 w-3" />
                      {uploading[i] ? "Subiendo…" : "Adjuntar archivo"}
                    </Button>
                  </>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="w-full text-xs"
              onClick={addStep}
            >
              + Agregar paso
            </Button>
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-2">
            <Label className="text-xs ml-auto">Activa</Label>
            <Switch
              checked={form.is_active}
              onCheckedChange={(v) => setForm({ ...form, is_active: v })}
            />
          </div>

          {/* Chain to rule */}
          <div className="space-y-1">
            <Label className="text-xs">Encadenar a otra regla (al terminar la secuencia)</Label>
            <Select
              value={form.chain_to_rule_id ?? "none"}
              onValueChange={(v) => setForm({ ...form, chain_to_rule_id: v === "none" ? null : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Ninguna" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ninguna</SelectItem>
                {rules
                  .filter((r: any) => r.id !== form.id)
                  .map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Limit per contact */}
          <div className="space-y-1">
            <Label className="text-xs">Límite de veces por usuario</Label>
            <Input
              type="number"
              placeholder="0 para ilimitado"
              value={form.limit_per_contact || ""}
              onChange={(e) => setForm({ ...form, limit_per_contact: e.target.value ? parseInt(e.target.value, 10) : null })}
            />
            <p className="text-[10px] text-muted-foreground">Dejar en 0 o vacío para no limitar</p>
          </div>

          {/* Additional actions */}
          <div className="space-y-2 border rounded p-2">
            <Label className="text-xs font-medium">Acciones adicionales</Label>
            <Select
              value={form.action_ai_behavior}
              onValueChange={(v: any) => setForm({ ...form, action_ai_behavior: v })}
            >
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Comportamiento IA" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no_change">No cambiar IA</SelectItem>
                <SelectItem value="disable_ai">Desactivar IA tras respuesta</SelectItem>
                <SelectItem value="enable_ai">Activar IA tras respuesta</SelectItem>
              </SelectContent>
            </Select>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground w-full">Agregar etiquetas:</span>
                {tags.map((t: any) => (
                  <label key={t.id} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={form.action_add_tags.includes(t.id)}
                      onChange={(e) => {
                        const arr = e.target.checked
                          ? [...form.action_add_tags, t.id]
                          : form.action_add_tags.filter((id) => id !== t.id);
                        setForm({ ...form, action_add_tags: arr });
                      }}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground w-full">Quitar etiquetas:</span>
                {tags.map((t: any) => (
                  <label key={t.id} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={form.action_remove_tags.includes(t.id)}
                      onChange={(e) => {
                        const arr = e.target.checked
                          ? [...form.action_remove_tags, t.id]
                          : form.action_remove_tags.filter((id) => id !== t.id);
                        setForm({ ...form, action_remove_tags: arr });
                      }}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="submit" className="flex-1">
              {form.id ? "Actualizar regla" : "Guardar regla"}
            </Button>
            {form.id && (
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      </Card>

      {/* ── Rule list ── */}
      <div className="space-y-2">
        {rules.length === 0 && (
          <Card className="p-6 text-center text-muted-foreground">Sin reglas</Card>
        )}
        {rules.map((r: any) => {
          const previewSteps: any[] = (r.steps ?? []).slice(0, 3);
          const totalSteps = (r.steps ?? []).length;
          const chainedRule = r.chain_to_rule_id
            ? rules.find((x: any) => x.id === r.chain_to_rule_id)
            : null;

          return (
            <Card key={r.id} className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{r.name}</span>
                    <Badge variant={r.is_active ? "default" : "secondary"}>
                      {r.is_active ? "activa" : "off"}
                    </Badge>
                    <Badge variant="outline">{r.trigger_type}</Badge>
                    <Badge variant="outline" className="text-xs">
                      {totalSteps} paso{totalSteps !== 1 ? "s" : ""}
                    </Badge>
                    {chainedRule && (
                      <Badge variant="secondary" className="flex items-center gap-1 text-xs">
                        <Link2 className="h-3 w-3" />
                        Encadena → {chainedRule.name}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.match_type}: "{r.match_value}"
                  </div>
                  {/* Preview first 3 steps */}
                  <div className="space-y-1 mt-1">
                    {previewSteps.map((s: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <span className="shrink-0 font-medium text-foreground">
                          #{i + 1}
                        </span>
                        {s.cooldown_seconds > 0 && (
                          <span className="shrink-0 flex items-center gap-0.5">
                            <Clock className="h-3 w-3" />
                            {formatCooldown(s.cooldown_seconds)}
                          </span>
                        )}
                        <span className="truncate">
                          {s.text_content || (s.media_url ? (s.mime_type?.startsWith("video/") ? "🎥 video" : s.mime_type?.startsWith("image/") ? "📎 imagen" : "📄 documento") : "—")}
                        </span>
                      </div>
                    ))}
                    {totalSteps > 3 && (
                      <div className="text-xs text-muted-foreground">
                        … y {totalSteps - 3} paso{totalSteps - 3 !== 1 ? "s" : ""} más
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => loadEdit(r)}
                  >
                    ✏️
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={async () => {
                      await del({ data: { id: r.id } });
                      qc.invalidateQueries({ queryKey: ["autoReplies"] });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// La UI de mensajes programados vive en el popover del chat
// (botón calendario en _authenticated.conversations.$threadId.tsx).
