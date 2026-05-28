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
} from "@/lib/automations.functions";
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
import { Trash2, X } from "lucide-react";

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
          <TabsTrigger value="scheduled">Programados</TabsTrigger>
          <TabsTrigger value="broadcast">Envío masivo</TabsTrigger>
        </TabsList>
        <TabsContent value="auto"><AutoRepliesTab /></TabsContent>
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
  const { data } = useQuery({ queryKey: ["autoReplies"], queryFn: () => list({}) });
  const [form, setForm] = useState({
    name: "", match_type: "contains" as const, match_value: "", reply_text: "", cooldown_seconds: 60, is_active: true,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await upsert({ data: form });
      toast.success("Regla guardada");
      setForm({ name: "", match_type: "contains", match_value: "", reply_text: "", cooldown_seconds: 60, is_active: true });
      qc.invalidateQueries({ queryKey: ["autoReplies"] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="grid md:grid-cols-2 gap-4 mt-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">Nueva regla</h3>
        <form onSubmit={submit} className="space-y-3">
          <Input placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
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
          <Textarea placeholder="Respuesta automática" value={form.reply_text} onChange={(e) => setForm({ ...form, reply_text: e.target.value })} required />
          <div className="flex items-center gap-3">
            <Label className="text-xs">Cooldown (seg)</Label>
            <Input type="number" className="w-24" value={form.cooldown_seconds} onChange={(e) => setForm({ ...form, cooldown_seconds: +e.target.value })} />
            <Label className="text-xs ml-auto">Activa</Label>
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
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
              </div>
              <div className="text-xs text-muted-foreground">{r.match_type}: "{r.match_value}"</div>
              <div className="text-sm mt-1 truncate">→ {r.reply_text}</div>
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

// ───── Broadcast ─────
function BroadcastTab() {
  const qc = useQueryClient();
  const list = useServerFn(listBroadcasts);
  const create = useServerFn(createBroadcast);
  const cancel = useServerFn(cancelBroadcast);
  const sess = useServerFn(listSessions);
  const { data } = useQuery({ queryKey: ["broadcasts"], queryFn: () => list({}), refetchInterval: 5000 });
  const { data: sessions } = useQuery({ queryKey: ["sessions"], queryFn: () => sess({}) });
  const [form, setForm] = useState({
    session_id: "", name: "", message_text: "", rate_per_minute: 15, wa_ids_raw: "", scheduled_at: "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const wa_ids = form.wa_ids_raw.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!wa_ids.length) { toast.error("Agrega destinatarios"); return; }
    try {
      await create({
        data: {
          session_id: form.session_id,
          name: form.name,
          message_text: form.message_text,
          rate_per_minute: form.rate_per_minute,
          wa_ids,
          scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        },
      });
      toast.success(`Envío creado (${wa_ids.length} dest.)`);
      setForm({ session_id: "", name: "", message_text: "", rate_per_minute: 15, wa_ids_raw: "", scheduled_at: "" });
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="grid md:grid-cols-2 gap-4 mt-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">Nuevo envío masivo</h3>
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
          <Textarea placeholder="Mensaje" value={form.message_text} onChange={(e) => setForm({ ...form, message_text: e.target.value })} required />
          <Textarea placeholder="WA IDs separados por coma, espacio o salto de línea" value={form.wa_ids_raw} onChange={(e) => setForm({ ...form, wa_ids_raw: e.target.value })} rows={4} required />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Rate / min</Label>
              <Input type="number" min={1} max={60} value={form.rate_per_minute} onChange={(e) => setForm({ ...form, rate_per_minute: +e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Programar (opcional)</Label>
              <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
            </div>
          </div>
          <Button type="submit" className="w-full">Crear envío</Button>
        </form>
      </Card>
      <div className="space-y-2">
        {data?.items.length === 0 && <Card className="p-6 text-center text-muted-foreground">Sin envíos</Card>}
        {data?.items.map((b: any) => (
          <Card key={b.id} className="p-3 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{b.name}</span>
              <Badge>{b.status}</Badge>
              <span className="text-xs text-muted-foreground ml-auto">{b.sent_count}/{b.total_count}</span>
              {["running", "scheduled"].includes(b.status) && (
                <Button size="icon" variant="ghost" onClick={async () => { await cancel({ data: { id: b.id } }); qc.invalidateQueries({ queryKey: ["broadcasts"] }); }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="text-sm truncate text-muted-foreground">{b.message_text}</div>
            <div className="h-1.5 bg-muted rounded overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${b.total_count ? (b.sent_count / b.total_count) * 100 : 0}%` }} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
