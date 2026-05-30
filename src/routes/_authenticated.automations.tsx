import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  listAutoReplies,
  upsertAutoReply,
  deleteAutoReply,
  listScheduled,
  createScheduled,
  cancelScheduled,
  listBroadcasts,
  createBroadcast,
  cancelBroadcast,
  getBroadcastRecipients,
  listQuickReplies,
  upsertQuickReply,
  deleteQuickReply,
} from "@/lib/automations.functions";
import { listTags } from "@/lib/tags.functions";
import { listSessions } from "@/lib/sessions.functions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trash2, X, Zap, MessageSquare, Users, AlertCircle, CheckCircle, Pause } from "lucide-react";

export const Route = createFileRoute("/_authenticated/automations")({
  component: AutomationsPage,
});

function AutomationsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Automatizaciones</h1>
      <Tabs defaultValue="auto">
        <TabsList>
          <TabsTrigger value="auto">Auto-respuestas</TabsTrigger>
          <TabsTrigger value="quick">Respuestas rápidas</TabsTrigger>
          <TabsTrigger value="scheduled">Programados</TabsTrigger>
          <TabsTrigger value="broadcast">Envío masivo</TabsTrigger>
        </TabsList>
        <TabsContent value="auto"><AutoRepliesTab /></TabsContent>
        <TabsContent value="quick"><QuickRepliesTab /></TabsContent>
        <TabsContent value="scheduled"><ScheduledTab /></TabsContent>
        <TabsContent value="broadcast"><BroadcastTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ───── Auto Replies ─────
function AutoRepliesTab() {
  const qc = useQueryClient();
  const list = useServerFn(listAutoReplies);
  const upsert = useServerFn(upsertAutoReply);
  const del = useServerFn(deleteAutoReply);
  const tagsFn = useServerFn(listTags);
  const { data } = useQuery({ queryKey: ["autoReplies"], queryFn: () => list({}) });
  const { data: tagsData } = useQuery({ queryKey: ["tags"], queryFn: () => tagsFn({}) });
  const tags = tagsData?.tags ?? [];
  const [form, setForm] = useState({
    name: "", match_type: "contains" as const, match_value: "", reply_text: "", cooldown_seconds: 60, is_active: true,
    trigger_type: "keyword" as const, media_url: "", mime_type: "", action_add_tags: [] as string[], action_remove_tags: [] as string[], action_ai_behavior: "no_change" as const,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...form,
      media_url: form.media_url || null,
      mime_type: form.mime_type || null,
      action_add_tags: form.action_add_tags.length ? form.action_add_tags : null,
      action_remove_tags: form.action_remove_tags.length ? form.action_remove_tags : null,
    };
    try {
      await upsert({ data: payload as any });
      toast.success("Regla guardada");
      setForm({ name: "", match_type: "contains", match_value: "", reply_text: "", cooldown_seconds: 60, is_active: true, trigger_type: "keyword", media_url: "", mime_type: "", action_add_tags: [], action_remove_tags: [], action_ai_behavior: "no_change" });
      qc.invalidateQueries({ queryKey: ["autoReplies"] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="grid md:grid-cols-2 gap-4 mt-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">Nueva regla</h3>
        <form onSubmit={submit} className="space-y-3">
          <Input placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Select value={form.trigger_type} onValueChange={(v: any) => setForm({ ...form, trigger_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="keyword">Palabra clave</SelectItem>
              <SelectItem value="first_message_overall">Primer mensaje (global)</SelectItem>
              <SelectItem value="first_message_month">Primer mensaje del mes</SelectItem>
            </SelectContent>
          </Select>
          {form.trigger_type === "keyword" && (
            <div className="grid grid-cols-2 gap-2">
              <Select value={form.match_type} onValueChange={(v: any) => setForm({ ...form, match_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">Contiene</SelectItem>
                  <SelectItem value="equals">Igual a</SelectItem>
                  <SelectItem value="starts">Empieza con</SelectItem>
                  <SelectItem value="regex">Regex</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Patrón" value={form.match_value} onChange={(e) => setForm({ ...form, match_value: e.target.value })} required />
            </div>
          )}
          <Textarea placeholder="Respuesta automática" value={form.reply_text} onChange={(e) => setForm({ ...form, reply_text: e.target.value })} required />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="URL media (opcional)" value={form.media_url} onChange={(e) => setForm({ ...form, media_url: e.target.value })} />
            <Input placeholder="MIME type (opcional)" value={form.mime_type} onChange={(e) => setForm({ ...form, mime_type: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-xs">Cooldown (seg)</Label>
            <Input type="number" className="w-24" value={form.cooldown_seconds} onChange={(e) => setForm({ ...form, cooldown_seconds: +e.target.value })} />
            <Label className="text-xs ml-auto">Activa</Label>
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          </div>
          <div className="space-y-2 border rounded p-2">
            <Label className="text-xs font-medium">Acciones adicionales</Label>
            <Select value={form.action_ai_behavior} onValueChange={(v: any) => setForm({ ...form, action_ai_behavior: v })}>
              <SelectTrigger className="text-xs"><SelectValue placeholder="Comportamiento IA" /></SelectTrigger>
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
                    <input type="checkbox" checked={form.action_add_tags.includes(t.id)} onChange={(e) => {
                      const arr = e.target.checked ? [...form.action_add_tags, t.id] : form.action_add_tags.filter((id) => id !== t.id);
                      setForm({ ...form, action_add_tags: arr });
                    }} />
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
                    <input type="checkbox" checked={form.action_remove_tags.includes(t.id)} onChange={(e) => {
                      const arr = e.target.checked ? [...form.action_remove_tags, t.id] : form.action_remove_tags.filter((id) => id !== t.id);
                      setForm({ ...form, action_remove_tags: arr });
                    }} />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button type="submit" className="w-full">Guardar regla</Button>
        </form>
      </Card>
      <div className="space-y-2">
        {data?.rules.length === 0 && <Card className="p-6 text-center text-muted-foreground">Sin reglas</Card>}
        {data?.rules.map((r: any) => (
          <Card key={r.id} className="p-3 flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.name}</span>
                <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "activa" : "off"}</Badge>
                <Badge variant="outline">{r.trigger_type}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">{r.match_type}: "{r.match_value}"</div>
              <div className="text-sm mt-1 truncate">→ {r.reply_text}</div>
              {r.media_url && <div className="text-xs text-blue-600 truncate">media: {r.media_url}</div>}
            </div>
            <Button size="icon" variant="ghost" onClick={async () => { await del({ data: { id: r.id } }); qc.invalidateQueries({ queryKey: ["autoReplies"] }); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ───── Quick Replies ─────
function QuickRepliesTab() {
  const qc = useQueryClient();
  const list = useServerFn(listQuickReplies);
  const upsert = useServerFn(upsertQuickReply);
  const del = useServerFn(deleteQuickReply);
  const { data } = useQuery({ queryKey: ["quickReplies"], queryFn: () => list({}) });
  const [form, setForm] = useState({ shortcut: "", text_content: "", media_url: "", mime_type: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await upsert({ data: { ...form, media_url: form.media_url || null, mime_type: form.mime_type || null } as any });
      toast.success("Guardado");
      setForm({ shortcut: "", text_content: "", media_url: "", mime_type: "" });
      qc.invalidateQueries({ queryKey: ["quickReplies"] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="grid md:grid-cols-2 gap-4 mt-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">Nueva respuesta rápida</h3>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">/</span>
            <Input placeholder="shortcut" value={form.shortcut} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} required className="flex-1" />
          </div>
          <Textarea placeholder="Contenido del mensaje" value={form.text_content} onChange={(e) => setForm({ ...form, text_content: e.target.value })} required />
          <Input placeholder="URL media (opcional)" value={form.media_url} onChange={(e) => setForm({ ...form, media_url: e.target.value })} />
          <Input placeholder="MIME type (opcional)" value={form.mime_type} onChange={(e) => setForm({ ...form, mime_type: e.target.value })} />
          <Button type="submit" className="w-full">Guardar</Button>
        </form>
      </Card>
      <div className="space-y-2">
        {data?.items.length === 0 && <Card className="p-6 text-center text-muted-foreground">Sin respuestas rápidas</Card>}
        {data?.items.map((r: any) => (
          <Card key={r.id} className="p-3 flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Zap className="h-3 w-3 text-yellow-500" />
                <span className="font-mono text-sm">/{r.shortcut}</span>
              </div>
              <div className="text-sm mt-1 truncate">{r.text_content}</div>
              {r.media_url && <div className="text-xs text-blue-600 truncate">media: {r.media_url}</div>}
            </div>
            <Button size="icon" variant="ghost" onClick={async () => { await del({ data: { id: r.id } }); qc.invalidateQueries({ queryKey: ["quickReplies"] }); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ───── Scheduled ─────
function ScheduledTab() {
  const qc = useQueryClient();
  const list = useServerFn(listScheduled);
  const create = useServerFn(createScheduled);
  const cancel = useServerFn(cancelScheduled);
  const sess = useServerFn(listSessions);
  const { data } = useQuery({ queryKey: ["scheduled"], queryFn: () => list({}) });
  const { data: sessions } = useQuery({ queryKey: ["sessions"], queryFn: () => sess({}) });
  const [form, setForm] = useState({ session_id: "", wa_id: "", text: "", send_at: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await create({ data: { ...form, send_at: new Date(form.send_at).toISOString() } });
      toast.success("Programado");
      setForm({ session_id: "", wa_id: "", text: "", send_at: "" });
      qc.invalidateQueries({ queryKey: ["scheduled"] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="grid md:grid-cols-2 gap-4 mt-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">Nuevo mensaje programado</h3>
        <form onSubmit={submit} className="space-y-3">
          <Select value={form.session_id} onValueChange={(v) => setForm({ ...form, session_id: v })}>
            <SelectTrigger><SelectValue placeholder="Sesión WhatsApp" /></SelectTrigger>
            <SelectContent>
              {sessions?.sessions.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="WA ID (ej: 5215512345678@c.us)" value={form.wa_id} onChange={(e) => setForm({ ...form, wa_id: e.target.value })} required />
          <Textarea placeholder="Mensaje" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} required />
          <Input type="datetime-local" value={form.send_at} onChange={(e) => setForm({ ...form, send_at: e.target.value })} required />
          <Button type="submit" className="w-full">Programar</Button>
        </form>
      </Card>
      <div className="space-y-2">
        {data?.items.length === 0 && <Card className="p-6 text-center text-muted-foreground">Sin programados</Card>}
        {data?.items.map((m: any) => (
          <Card key={m.id} className="p-3 flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant={m.status === "pending" ? "default" : "secondary"}>{m.status}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(m.send_at).toLocaleString()}</span>
              </div>
              <div className="text-xs font-mono">{m.wa_id}</div>
              <div className="text-sm mt-1 truncate">{m.text}</div>
            </div>
            {m.status === "pending" && (
              <Button size="icon" variant="ghost" onClick={async () => { await cancel({ data: { id: m.id } }); qc.invalidateQueries({ queryKey: ["scheduled"] }); }}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ───── Broadcast ─────
function BroadcastTab() {
  const qc = useQueryClient();
  const list = useServerFn(listBroadcasts);
  const create = useServerFn(createBroadcast);
  const cancel = useServerFn(cancelBroadcast);
  const recipientsFn = useServerFn(getBroadcastRecipients);
  const sess = useServerFn(listSessions);
  const tagsFn = useServerFn(listTags);
  const { data } = useQuery({ queryKey: ["broadcasts"], queryFn: () => list({}), refetchInterval: 5000 });
  const { data: sessions } = useQuery({ queryKey: ["sessions"], queryFn: () => sess({}) });
  const { data: tagsData } = useQuery({ queryKey: ["tags"], queryFn: () => tagsFn({}) });
  const tags = tagsData?.tags ?? [];
  const [form, setForm] = useState({
    session_id: "", name: "", message_text: "", rate_per_minute: 15, wa_ids_raw: "", scheduled_at: "", tag_id: "", media_url: "", mime_type: "",
  });
  const [mode, setMode] = useState<"manual" | "tag">("tag");
  const [expanded, setExpanded] = useState<string | null>(null);

  const tagCount = mode === "tag" && form.tag_id
    ? tags.find((t: any) => t.id === form.tag_id)?.contact_count
    : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const wa_ids = mode === "manual"
      ? form.wa_ids_raw.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean)
      : undefined;
    if (mode === "manual" && (!wa_ids || !wa_ids.length)) { toast.error("Agrega destinatarios"); return; }
    try {
      await create({
        data: {
          session_id: form.session_id,
          name: form.name,
          message_text: form.message_text,
          rate_per_minute: form.rate_per_minute,
          tag_id: mode === "tag" ? (form.tag_id || null) : null,
          wa_ids: wa_ids ?? null,
          media_url: form.media_url || null,
          mime_type: form.mime_type || null,
          scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        } as any,
      });
      toast.success("Campaña creada");
      setForm({ session_id: "", name: "", message_text: "", rate_per_minute: 15, wa_ids_raw: "", scheduled_at: "", tag_id: "", media_url: "", mime_type: "" });
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="grid md:grid-cols-2 gap-4 mt-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">Nueva campaña</h3>
        <form onSubmit={submit} className="space-y-3">
          <Input placeholder="Nombre de campaña" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Select value={form.session_id} onValueChange={(v) => setForm({ ...form, session_id: v })}>
            <SelectTrigger><SelectValue placeholder="Sesión WhatsApp" /></SelectTrigger>
            <SelectContent>
              {sessions?.sessions.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea placeholder="Mensaje de la campaña" value={form.message_text} onChange={(e) => setForm({ ...form, message_text: e.target.value })} required />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="URL imagen/documento (opcional)" value={form.media_url} onChange={(e) => setForm({ ...form, media_url: e.target.value })} />
            <Input placeholder="MIME type (opcional)" value={form.mime_type} onChange={(e) => setForm({ ...form, mime_type: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant={mode === "tag" ? "default" : "outline"} size="sm" onClick={() => setMode("tag")}>Por etiqueta</Button>
            <Button type="button" variant={mode === "manual" ? "default" : "outline"} size="sm" onClick={() => setMode("manual")}>Manual</Button>
          </div>
          {mode === "tag" ? (
            <div className="space-y-1">
              <Select value={form.tag_id} onValueChange={(v) => setForm({ ...form, tag_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecciona etiqueta" /></SelectTrigger>
                <SelectContent>
                  {tags.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.tag_id && (
                <p className="text-xs text-muted-foreground">
                  Impactará a contactos con etiqueta seleccionada.
                </p>
              )}
            </div>
          ) : (
            <Textarea placeholder="WA IDs separados por coma, espacio o salto de línea" value={form.wa_ids_raw} onChange={(e) => setForm({ ...form, wa_ids_raw: e.target.value })} rows={3} />
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Velocidad (msg/min)</Label>
              <Input type="number" min={5} max={30} value={form.rate_per_minute} onChange={(e) => setForm({ ...form, rate_per_minute: +e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Programar (opcional)</Label>
              <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
            </div>
          </div>
          <Button type="submit" className="w-full">Crear campaña</Button>
        </form>
      </Card>
      <div className="space-y-2">
        {data?.items.length === 0 && <Card className="p-6 text-center text-muted-foreground">Sin campañas</Card>}
        {data?.items.map((b: any) => {
          const progress = b.total_count ? ((b.sent_count + b.failed_count) / b.total_count) * 100 : 0;
          const isOpen = expanded === b.id;
          return (
            <Card key={b.id} className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{b.name}</span>
                <Badge variant={b.status === "running" ? "default" : b.status === "failed" ? "destructive" : "secondary"}>{b.status}</Badge>
                {b.tag_id && <Badge variant="outline">etiqueta</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">{b.sent_count + b.failed_count}/{b.total_count}</span>
                {["running", "scheduled"].includes(b.status) && (
                  <Button size="icon" variant="ghost" onClick={async () => { await cancel({ data: { id: b.id } }); qc.invalidateQueries({ queryKey: ["broadcasts"] }); }}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="text-sm truncate text-muted-foreground">{b.message_text}</div>
              {b.media_url && <div className="text-xs text-blue-600 truncate">media: {b.media_url}</div>}
              <Progress value={progress} className="h-2" />
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-green-600"><CheckCircle className="h-3 w-3" /> {b.sent_count}</span>
                <span className="flex items-center gap-1 text-red-600"><AlertCircle className="h-3 w-3" /> {b.failed_count}</span>
                <span className="flex items-center gap-1 text-muted-foreground"><Users className="h-3 w-3" /> {b.total_count}</span>
                <Button variant="ghost" size="sm" className="ml-auto text-xs h-6" onClick={() => setExpanded(isOpen ? null : b.id)}>
                  {isOpen ? "Ocultar" : "Detalles"}
                </Button>
              </div>
              {isOpen && <BroadcastRecipients broadcastId={b.id} recipientsFn={recipientsFn} />}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function BroadcastRecipients({ broadcastId, recipientsFn }: { broadcastId: string; recipientsFn: (args: { data: { broadcastId: string } }) => Promise<{ items: any[] }> }) {
  const { data } = useQuery({ queryKey: ["broadcastRecipients", broadcastId], queryFn: () => recipientsFn({ data: { broadcastId } }), enabled: !!broadcastId });
  if (!data?.items.length) return <p className="text-xs text-muted-foreground">Sin destinatarios</p>;
  return (
    <div className="max-h-40 overflow-y-auto space-y-1 border-t pt-2">
      {data.items.map((r: any) => (
        <div key={r.id} className="flex items-center justify-between text-xs">
          <span className="font-mono truncate">{r.wa_id}</span>
          <Badge variant={r.status === "sent" ? "default" : r.status === "failed" ? "destructive" : "outline"} className="text-[10px] h-5">
            {r.status}
          </Badge>
        </div>
      ))}
    </div>
  );
}
