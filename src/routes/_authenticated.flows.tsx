import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  listFlows,
  upsertFlow,
  deleteFlow,
  setFlowActive,
  listFlowSteps,
  upsertFlowStep,
  deleteFlowStep,
  listKnowledgeSources,
  listTransferRules,
} from "@/lib/automations.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Zap, GitBranch, Plus, Save, X, ArrowRight, Clock, MessageSquare, Image, Tag, Bot, Sparkles, BookOpen, UserCheck, Settings } from "lucide-react";

interface Flow {
  id: string;
  name: string;
  trigger_type: string;
  trigger_value?: string | null;
  description?: string | null;
  is_active: boolean;
}

interface FlowStepItem {
  id: string;
  flow_id: string;
  step_type: string;
  step_order: number;
  step_data: Record<string, unknown>;
  parent_step_id?: string | null;
  branch?: string | null;
}

export const Route = createFileRoute("/_authenticated/flows")({
  component: FlowsPage,
});

function FlowsPage() {
  const [editingFlow, setEditingFlow] = useState<string | null>(null);
  const qc = useQueryClient();
  const listFn = useServerFn(listFlows);
  const { data } = useQuery({ queryKey: ["flows"], queryFn: () => listFn({}) });
  const flows = (data as { flows?: Flow[] })?.flows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Flujos</h1>
        <Button onClick={() => setEditingFlow("new")}><Plus className="h-4 w-4 mr-1" />Nuevo flujo</Button>
      </div>
      {editingFlow && (
        <FlowEditor flowId={editingFlow} onClose={() => { setEditingFlow(null); qc.invalidateQueries({ queryKey: ["flows"] }); }} />
      )}
      <div className="grid gap-3">
        {flows.map((f: Flow) => (
          <FlowCard key={f.id} flow={f} onEdit={() => setEditingFlow(f.id)} />
        ))}
        {flows.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No hay flujos. Crea uno para automatizar el recorrido de tus contactos.
          </Card>
        )}
      </div>
    </div>
  );
}

function FlowCard({ flow, onEdit }: { flow: Flow; onEdit: () => void }) {
  const qc = useQueryClient();
  const setActiveFn = useServerFn(setFlowActive);
  const deleteFn = useServerFn(deleteFlow);
  const [active, setActive] = useState(flow.is_active);

  return (
    <Card className="p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2 rounded-md bg-muted">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{flow.name}</p>
            <Badge variant={active ? "default" : "secondary"} className="text-[10px]">
              {active ? "Activo" : "Inactivo"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {flow.trigger_type === "keyword" ? `Palabra clave: ${flow.trigger_value ?? "-"}` : flow.trigger_type === "new_contact" ? "Nuevo contacto" : flow.trigger_type === "tag_added" ? `Etiqueta: ${flow.trigger_value ?? "-"}` : "Manual"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch
          checked={active}
          onCheckedChange={async (v) => {
            setActive(v);
            await setActiveFn({ data: { id: flow.id, is_active: v } });
            qc.invalidateQueries({ queryKey: ["flows"] });
          }}
        />
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Sparkles className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (!confirm("Eliminar flujo?")) return;
            await deleteFn({ data: { id: flow.id } });
            qc.invalidateQueries({ queryKey: ["flows"] });
          }}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </Card>
  );
}

function FlowEditor({ flowId, onClose }: { flowId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const upsertFlowFn = useServerFn(upsertFlow);
  const listFlowsFn = useServerFn(listFlows);
  const listStepsFn = useServerFn(listFlowSteps);
  const upsertStepFn = useServerFn(upsertFlowStep);
  const deleteStepFn = useServerFn(deleteFlowStep);

  const isNew = flowId === "new";
  const { data: listData } = useQuery({ queryKey: ["flows"], queryFn: () => listFlowsFn({}) });
  const existing = (listData as { flows?: Flow[] })?.flows?.find((f: Flow) => f.id === flowId);

  const [name, setName] = useState(existing?.name ?? "");
  const [triggerType, setTriggerType] = useState(existing?.trigger_type ?? "manual");
  const [triggerValue, setTriggerValue] = useState(existing?.trigger_value ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");

  // AI Configuration
  const [aiMode, setAiMode] = useState(existing?.ai_mode ?? "none");
  const [aiTimeLimitMinutes, setAiTimeLimitMinutes] = useState(existing?.ai_time_limit_minutes ?? 30);
  const [aiEnabledAfterFlow, setAiEnabledAfterFlow] = useState(existing?.ai_enabled_after_flow ?? false);
  const [aiEnabledDuringFlow, setAiEnabledDuringFlow] = useState(existing?.ai_enabled_during_flow ?? false);
  const [aiFallbackEnabled, setAiFallbackEnabled] = useState(existing?.ai_fallback_enabled ?? false);
  const [aiTransferOnFailure, setAiTransferOnFailure] = useState(existing?.ai_transfer_on_failure ?? false);
  const [aiMaintainContext, setAiMaintainContext] = useState(existing?.ai_maintain_context ?? true);
  const [aiCanAccessCrm, setAiCanAccessCrm] = useState(existing?.ai_can_access_crm ?? true);
  const [aiCanAccessTags, setAiCanAccessTags] = useState(existing?.ai_can_access_tags ?? true);
  const [aiCustomSystemPrompt, setAiCustomSystemPrompt] = useState(existing?.ai_custom_system_prompt ?? "");

  // Load knowledge sources and transfer rules
  const listKbFn = useServerFn(listKnowledgeSources);
  const listTrFn = useServerFn(listTransferRules);
  const { data: kbData } = useQuery({ queryKey: ["knowledgeSources"], queryFn: () => listKbFn({}) });
  const { data: trData } = useQuery({ queryKey: ["transferRules"], queryFn: () => listTrFn({}) });
  const knowledgeSources = (kbData as { items?: any[] })?.items ?? [];
  const transferRules = (trData as { items?: any[] })?.items ?? [];

  const { data: stepsData } = useQuery({
    queryKey: ["flowSteps", flowId],
    queryFn: () => listStepsFn({ data: { flowId } }),
    enabled: !isNew,
  });
  const steps = (stepsData as { steps?: FlowStepItem[] })?.steps ?? [];

  const [editingStep, setEditingStep] = useState<FlowStepItem | null>(null);

  const saveFlowMeta = async () => {
    const res = await upsertFlowFn({
      data: {
        id: isNew ? undefined : flowId,
        name,
        trigger_type: triggerType,
        trigger_value: triggerValue || null,
        description,
        ai_mode: aiMode,
        ai_time_limit_minutes: aiMode === "time_limited" ? aiTimeLimitMinutes : null,
        ai_enabled_after_flow: aiEnabledAfterFlow,
        ai_enabled_during_flow: aiEnabledDuringFlow,
        ai_fallback_enabled: aiFallbackEnabled,
        ai_transfer_on_failure: aiTransferOnFailure,
        ai_maintain_context: aiMaintainContext,
        ai_can_access_crm: aiCanAccessCrm,
        ai_can_access_tags: aiCanAccessTags,
        ai_knowledge_sources: [],
        ai_transfer_rules: [],
        ai_custom_system_prompt: aiCustomSystemPrompt || null,
      },
    });
    const savedFlow = (res as any)?.flow;
    if (savedFlow) {
      toast.success("Flujo guardado");
      if (isNew) {
        onClose();
        return;
      }
      qc.invalidateQueries({ queryKey: ["flows"] });
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{isNew ? "Nuevo flujo" : "Editar flujo"}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Bienvenida" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Disparador</Label>
          <Select value={triggerType} onValueChange={setTriggerType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="keyword">Palabra clave</SelectItem>
              <SelectItem value="new_contact">Nuevo contacto</SelectItem>
              <SelectItem value="tag_added">Etiqueta añadida</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {triggerType !== "manual" && triggerType !== "new_contact" && (
          <div className="space-y-1">
            <Label className="text-xs">Valor disparador</Label>
            <Input value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} placeholder="Ej: promo" />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Descripción</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opcional" rows={2} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={saveFlowMeta}><Save className="h-4 w-4 mr-1" />Guardar flujo</Button>
      </div>

      {/* AI Configuration Section */}
      <div className="space-y-3 pt-2 border-t">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Configuración de IA</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Modo de IA</Label>
            <Select value={aiMode} onValueChange={setAiMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No activar IA</SelectItem>
                <SelectItem value="on_completion">Activar al finalizar flujo</SelectItem>
                <SelectItem value="during_flow">Activar durante todo el flujo</SelectItem>
                <SelectItem value="on_response">Activar solo si responde</SelectItem>
                <SelectItem value="fallback">IA como respaldo</SelectItem>
                <SelectItem value="time_limited">IA con límite de tiempo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {aiMode === "time_limited" && (
            <div className="space-y-1">
              <Label className="text-xs">Límite de tiempo (minutos)</Label>
              <Input type="number" value={aiTimeLimitMinutes} onChange={(e) => setAiTimeLimitMinutes(Number(e.target.value))} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="flex items-center gap-2">
            <Switch checked={aiEnabledAfterFlow} onCheckedChange={setAiEnabledAfterFlow} />
            <Label className="text-xs">Activar al finalizar</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={aiEnabledDuringFlow} onCheckedChange={setAiEnabledDuringFlow} />
            <Label className="text-xs">Activar durante flujo</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={aiFallbackEnabled} onCheckedChange={setAiFallbackEnabled} />
            <Label className="text-xs">Usar como respaldo</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={aiTransferOnFailure} onCheckedChange={setAiTransferOnFailure} />
            <Label className="text-xs">Transferir si falla</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={aiMaintainContext} onCheckedChange={setAiMaintainContext} />
            <Label className="text-xs">Mantener contexto</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={aiCanAccessCrm} onCheckedChange={setAiCanAccessCrm} />
            <Label className="text-xs">Acceso a CRM</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={aiCanAccessTags} onCheckedChange={setAiCanAccessTags} />
            <Label className="text-xs">Acceso a etiquetas</Label>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Prompt del sistema personalizado (opcional)</Label>
          <Textarea value={aiCustomSystemPrompt} onChange={(e) => setAiCustomSystemPrompt(e.target.value)} placeholder="Instrucciones personalizadas para la IA..." rows={2} />
        </div>
      </div>

      {!isNew && (
        <div className="space-y-3 pt-2 border-t">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Pasos del flujo</h3>
            <Button size="sm" variant="outline" onClick={() => setEditingStep({ id: undefined, step_type: "send_message", step_order: steps.length + 1, step_data: {}, parent_step_id: null, branch: null })}>
              <Plus className="h-4 w-4 mr-1" /> Paso
            </Button>
          </div>
          <div className="space-y-2">
            {steps.map((s: any) => (
              <StepRow key={s.id} step={s} onEdit={() => setEditingStep(s)} onDelete={async () => {
                await deleteStepFn({ data: { id: s.id } });
                qc.invalidateQueries({ queryKey: ["flowSteps", flowId] });
              }} />
            ))}
            {steps.length === 0 && (
              <p className="text-xs text-muted-foreground">Aún no hay pasos. Agrega el primero.</p>
            )}
          </div>
        </div>
      )}

      {editingStep && (
        <StepEditor
          flowId={flowId}
          step={editingStep}
          steps={steps}
          onSave={async (payload) => {
            await upsertStepFn({ data: payload });
            qc.invalidateQueries({ queryKey: ["flowSteps", flowId] });
            setEditingStep(null);
          }}
          onCancel={() => setEditingStep(null)}
        />
      )}
    </Card>
  );
}

function StepRow({ step, onEdit, onDelete }: { step: FlowStepItem; onEdit: () => void; onDelete: () => void }) {
  const icon = stepIcons[step.step_type] ?? <Zap className="h-4 w-4" />;
  return (
    <div className="flex items-center justify-between p-2 rounded-md border hover:bg-muted/40 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">{stepLabels[step.step_type] ?? step.step_type}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {step.step_data?.text ? `${step.step_data.text.slice(0, 40)}…` : step.step_data?.amount ? `${step.step_data.amount} ${step.step_data.unit}` : JSON.stringify(step.step_data).slice(0, 40)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {step.branch && <Badge variant="outline" className="text-[10px]">{step.branch}</Badge>}
        <Button variant="ghost" size="sm" onClick={onEdit}><Sparkles className="h-3 w-3" /></Button>
        <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 className="h-3 w-3 text-destructive" /></Button>
      </div>
    </div>
  );
}

const stepLabels: Record<string, string> = {
  send_message: "Enviar mensaje",
  send_media: "Enviar media",
  wait: "Esperar",
  add_tag: "Añadir etiqueta",
  remove_tag: "Quitar etiqueta",
  toggle_ai: "Activar/Desactivar IA",
  condition_reply: "Condición: ¿respondió?",
};

const stepIcons: Record<string, React.ReactNode> = {
  send_message: <MessageSquare className="h-4 w-4" />,
  send_media: <Image className="h-4 w-4" />,
  wait: <Clock className="h-4 w-4" />,
  add_tag: <Tag className="h-4 w-4" />,
  remove_tag: <Tag className="h-4 w-4 text-destructive" />,
  toggle_ai: <Bot className="h-4 w-4" />,
  condition_reply: <GitBranch className="h-4 w-4" />,
};

function StepEditor({ flowId, step, steps, onSave, onCancel }: { flowId: string; step: FlowStepItem; steps: FlowStepItem[]; onSave: (p: Record<string, unknown>) => void; onCancel: () => void }) {
  const [type, setType] = useState(step.step_type);
  const [order, setOrder] = useState(step.step_order);
  const [text, setText] = useState(step.step_data?.text ?? "");
  const [mediaUrl, setMediaUrl] = useState(step.step_data?.media_url ?? "");
  const [mimeType, setMimeType] = useState(step.step_data?.mime_type ?? "");
  const [mediaType, setMediaType] = useState(step.step_data?.media_type ?? "image");
  const [amount, setAmount] = useState(step.step_data?.amount ?? 1);
  const [unit, setUnit] = useState(step.step_data?.unit ?? "hours");
  const [tagId, setTagId] = useState(step.step_data?.tag_id ?? "");
  const [aiEnabled, setAiEnabled] = useState(step.step_data?.ai_enabled ?? true);
  const [parentStepId, setParentStepId] = useState(step.parent_step_id ?? "none");
  const [branch, setBranch] = useState(step.branch ?? "yes");

  const conditionParents = steps.filter((s: FlowStepItem) => s.step_type === "condition_reply" && s.id !== step.id);

  return (
    <div className="space-y-3 p-3 rounded-md border bg-muted/30">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="send_message">Enviar mensaje</SelectItem>
              <SelectItem value="send_media">Enviar media</SelectItem>
              <SelectItem value="wait">Esperar</SelectItem>
              <SelectItem value="add_tag">Añadir etiqueta</SelectItem>
              <SelectItem value="remove_tag">Quitar etiqueta</SelectItem>
              <SelectItem value="toggle_ai">Activar/Desactivar IA</SelectItem>
              <SelectItem value="condition_reply">Condición: ¿respondió?</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Orden</Label>
          <Input type="number" value={order} onChange={(e) => setOrder(Number(e.target.value))} />
        </div>
      </div>

      {type === "send_message" && (
        <div className="space-y-1">
          <Label className="text-xs">Texto</Label>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
        </div>
      )}

      {type === "send_media" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Tipo de media</Label>
            <Select value={mediaType} onValueChange={setMediaType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="image">Imagen</SelectItem>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="document">Documento</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Adjuntar archivo</Label>
            <Input type="file" accept={mediaType === "image" ? "image/*" : mediaType === "video" ? "video/*" : mediaType === "audio" ? "audio/*" : "*/*"} onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              // Aquí se implementaría la subida a Supabase
              // Por ahora, creamos una URL local temporal
              const url = URL.createObjectURL(file);
              setMediaUrl(url);
              if (mediaType === "document") {
                setMimeType(file.name);
              }
            }} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">O URL del archivo</Label>
            <Input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Caption (opcional)</Label>
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Texto descriptivo del archivo" />
          </div>
          {mediaType === "document" && (
            <div className="space-y-1">
              <Label className="text-xs">Nombre del archivo (opcional)</Label>
              <Input value={mimeType} onChange={(e) => setMimeType(e.target.value)} placeholder="documento.pdf" />
            </div>
          )}
        </div>
      )}

      {type === "wait" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Cantidad</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Unidad</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutos</SelectItem>
                <SelectItem value="hours">Horas</SelectItem>
                <SelectItem value="days">Días</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {(type === "add_tag" || type === "remove_tag") && (
        <div className="space-y-1">
          <Label className="text-xs">Tag ID (UUID)</Label>
          <Input value={tagId} onChange={(e) => setTagId(e.target.value)} placeholder="uuid de etiqueta" />
        </div>
      )}

      {type === "toggle_ai" && (
        <div className="flex items-center gap-2">
          <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} />
          <Label className="text-xs">IA activada</Label>
        </div>
      )}

      {conditionParents.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Paso padre (bifurcación)</Label>
            <Select value={parentStepId ?? "none"} onValueChange={setParentStepId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ninguno (secuencia principal)</SelectItem>
                {conditionParents.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{stepLabels[p.step_type] ?? p.step_type} #{p.step_order}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {parentStepId && parentStepId !== "none" && (
            <div className="space-y-1">
              <Label className="text-xs">Rama</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Sí (respondió)</SelectItem>
                  <SelectItem value="no">No (no respondió)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave({
          id: step.id,
          flow_id: flowId,
          step_type: type,
          step_order: order,
          step_data: type === "send_message" ? { text } : type === "send_media" ? { media_url: mediaUrl, media_type: mediaType, mime_type: mimeType, caption: text } : type === "wait" ? { amount, unit } : type === "add_tag" || type === "remove_tag" ? { tag_id: tagId } : type === "toggle_ai" ? { ai_enabled: aiEnabled } : {},
          parent_step_id: parentStepId === "none" ? null : parentStepId,
          branch: parentStepId && parentStepId !== "none" ? branch : null,
        })}>
          <Save className="h-4 w-4 mr-1" /> Guardar paso
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}><X className="h-4 w-4 mr-1" />Cancelar</Button>
      </div>
    </div>
  );
}
