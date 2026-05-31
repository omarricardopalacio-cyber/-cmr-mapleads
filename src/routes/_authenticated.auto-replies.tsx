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
import { Trash2, X, MessageSquare, Zap, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/auto-replies")({
  component: AutoRepliesPage,
});

function AutoRepliesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Auto-respuestas</h1>
      <Tabs defaultValue="auto">
        <TabsList>
          <TabsTrigger value="auto" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Reglas de Auto-respuesta
          </TabsTrigger>
          <TabsTrigger value="scheduled" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Mensajes Programados
          </TabsTrigger>
        </TabsList>
        <TabsContent value="auto">
          <AutoRepliesTab />
        </TabsContent>
        <TabsContent value="scheduled">
          <ScheduledTab />
        </TabsContent>
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
