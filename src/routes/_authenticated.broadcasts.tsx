// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  listBroadcasts,
  createBroadcast,
  cancelBroadcast,
  pauseBroadcast,
  resumeBroadcast,
  deleteBroadcast,
  getBroadcastRecipients,
} from "@/lib/automations.functions";
import { listTags } from "@/lib/tags.functions";
import { listSessions } from "@/lib/sessions.functions";
import { getUnsentLeadPhones } from "@/lib/leads.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { uploadMedia, mediaKindFromMime } from "@/lib/upload-media";
import { X, Users, AlertCircle, CheckCircle, Loader2, Paperclip, Play, Pause, Trash2, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/broadcasts")({
  component: BroadcastsPage,
});

function BroadcastsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Campañas Masivas</h1>
      <BroadcastContent />
    </div>
  );
}

function BroadcastContent() {
  const qc = useQueryClient();
  const list = useServerFn(listBroadcasts);
  const create = useServerFn(createBroadcast);
  const cancel = useServerFn(cancelBroadcast);
  const pause = useServerFn(pauseBroadcast);
  const resume = useServerFn(resumeBroadcast);
  const del = useServerFn(deleteBroadcast);
  const recipientsFn = useServerFn(getBroadcastRecipients);
  const sess = useServerFn(listSessions);
  const tagsFn = useServerFn(listTags);
  const unsentFn = useServerFn(getUnsentLeadPhones);
  const { data } = useQuery({ queryKey: ["broadcasts"], queryFn: () => list({}), refetchInterval: 5000 });
  const { data: sessions } = useQuery({ queryKey: ["sessions"], queryFn: () => sess({}) });
  const { data: tagsData } = useQuery({ queryKey: ["tags"], queryFn: () => tagsFn({}) });
  const { data: unsentData } = useQuery({ queryKey: ["mapleadsUnsent"], queryFn: () => unsentFn({}) });
  const tags = tagsData?.tags ?? [];
  const [form, setForm] = useState({
    session_id: "", name: "", message_text: "", rate_per_minute: 15, wa_ids_raw: "", scheduled_at: "", tag_id: "", media_url: "", mime_type: "",
  });
  const [mode, setMode] = useState<"manual" | "tag" | "mapleads">("tag");
  const [mediaType, setMediaType] = useState<"image" | "video" | "audio" | "document">("image");
  const [uploading, setUploading] = useState(false);
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
          audience: mode === "mapleads" ? "mapleads" : null,
          wa_ids: wa_ids ?? null,
          media_url: form.media_url || null,
          mime_type: form.mime_type || null,
          scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        } as any,
      });
      toast.success("Campaña creada");
      setForm({ session_id: "", name: "", message_text: "", rate_per_minute: 15, wa_ids_raw: "", scheduled_at: "", tag_id: "", media_url: "", mime_type: "" });
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      qc.invalidateQueries({ queryKey: ["mapleadsUnsent"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    } catch (e: any) { toast.error(e.message); }
  };

  const handleDownloadReport = async (broadcastId: string, name: string) => {
    try {
      const res = await recipientsFn({ data: { broadcastId } });
      const rows = res.items || [];
      const csv = ["wa_id,status,error,sent_at"];
      rows.forEach(r => {
        csv.push(`${r.wa_id},${r.status},${r.error || ""},${r.sent_at || ""}`);
      });
      const blob = new Blob(["\uFEFF" + csv.join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `reporte-${name.replace(/\s+/g, "_")}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      toast.error("Error al descargar reporte");
    }
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
          <div className="space-y-2 border rounded-md p-3 bg-muted/20">
            <Label className="text-xs flex items-center gap-1"><Paperclip className="h-3 w-3" /> Adjuntar media (opcional)</Label>
            <Select value={mediaType} onValueChange={(v: any) => setMediaType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="image">Imagen</SelectItem>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="document">Documento</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
              </SelectContent>
            </Select>
            <Input type="file" accept={mediaType === "image" ? "image/*" : mediaType === "video" ? "video/*" : mediaType === "audio" ? "audio/*" : "*/*"} disabled={uploading} onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setUploading(true);
                const { url, mime_type } = await uploadMedia(file);
                setForm({ ...form, media_url: url, mime_type });
                setMediaType(mediaKindFromMime(mime_type));
                toast.success("Archivo subido");
              } catch (err: any) {
                toast.error("Error al subir: " + err.message);
              } finally {
                setUploading(false);
              }
            }} />
            {uploading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Subiendo...</div>}
            {form.media_url && !uploading && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-green-600 truncate flex-1">✓ {form.mime_type}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setForm({ ...form, media_url: "", mime_type: "" })}>Quitar</Button>
              </div>
            )}
            <Input placeholder="O pega URL pública" value={form.media_url} onChange={(e) => setForm({ ...form, media_url: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="button" variant={mode === "tag" ? "default" : "outline"} size="sm" onClick={() => setMode("tag")}>Por etiqueta</Button>
            <Button type="button" variant={mode === "mapleads" ? "default" : "outline"} size="sm" onClick={() => setMode("mapleads")}>Leads Mapleads</Button>
            <Button type="button" variant={mode === "manual" ? "default" : "outline"} size="sm" onClick={() => setMode("manual")}>Manual</Button>
          </div>
          {mode === "tag" && (
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
          )}
          {mode === "mapleads" && (
            <div className="space-y-1 border rounded-md p-3 bg-muted/20">
              <p className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" /> Leads Mapleads (no enviados)
              </p>
              <p className="text-xs text-muted-foreground">
                Se enviará a <span className="font-mono font-semibold">{unsentData?.items.length ?? 0}</span> teléfonos extraídos por la extensión Mapleads. Cada lead se bloquea tras enviar para no recibir un segundo mensaje.
              </p>
            </div>
          )}
          {mode === "manual" && (
            <Textarea placeholder="WA IDs separados por coma, espacio o salto de línea" value={form.wa_ids_raw} onChange={(e) => setForm({ ...form, wa_ids_raw: e.target.value })} rows={3} />
          )}
          <div className="space-y-2 border rounded-md p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Velocidad (msg/min)</Label>
              <span className="text-xs font-mono font-semibold">{form.rate_per_minute} msg/min</span>
            </div>
            <input
              type="range"
              min={1}
              max={60}
              step={1}
              value={form.rate_per_minute}
              onChange={(e) => setForm({ ...form, rate_per_minute: +e.target.value })}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Lento (1)</span>
              <span>Seguro (10-15)</span>
              <span>Agresivo (60)</span>
            </div>
            <p className="text-[11px] text-amber-600">
              {form.rate_per_minute <= 5 && "✓ Muy seguro contra bloqueos."}
              {form.rate_per_minute > 5 && form.rate_per_minute <= 15 && "✓ Velocidad recomendada para evitar bloqueos de WhatsApp."}
              {form.rate_per_minute > 15 && form.rate_per_minute <= 30 && "⚠ Velocidad media: posible riesgo en cuentas nuevas."}
              {form.rate_per_minute > 30 && "⚠ Alta velocidad: riesgo elevado de bloqueo."}
            </p>
          </div>
          <div>
            <Label className="text-xs">Programar (opcional)</Label>
            <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
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
                  <Button size="icon" variant="ghost" title="Detener campaña (Pausar)" onClick={async () => {
                    await pause({ data: { id: b.id } });
                    qc.invalidateQueries({ queryKey: ["broadcasts"] });
                  }}>
                    <Pause className="h-4 w-4 text-amber-500" />
                  </Button>
                )}
                {b.status === "paused" && (
                  <Button size="icon" variant="ghost" title="Iniciar campaña (Reanudar)" onClick={async () => {
                    await resume({ data: { id: b.id } });
                    qc.invalidateQueries({ queryKey: ["broadcasts"] });
                  }}>
                    <Play className="h-4 w-4 text-green-500" />
                  </Button>
                )}
                {["paused", "cancelled", "completed", "failed"].includes(b.status) && (
                  <Button size="icon" variant="ghost" title="Descargar reporte" onClick={() => handleDownloadReport(b.id, b.name)}>
                    <Download className="h-4 w-4 text-blue-500" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" title="Borrar campaña" onClick={async () => {
                  if(!confirm("¿Borrar campaña? Esto no se puede deshacer.")) return;
                  await del({ data: { id: b.id } });
                  qc.invalidateQueries({ queryKey: ["broadcasts"] });
                }}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
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
