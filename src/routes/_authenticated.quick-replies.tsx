import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  listQuickReplies,
  upsertQuickReply,
  deleteQuickReply,
} from "@/lib/automations.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Zap } from "lucide-react";

export const Route = createFileRoute("/_authenticated/quick-replies")({
  component: QuickRepliesPage,
});

function QuickRepliesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Respuestas Rápidas</h1>
      <QuickRepliesContent />
    </div>
  );
}

function QuickRepliesContent() {
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
