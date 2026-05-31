import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  listKnowledgeSources,
  upsertKnowledgeSource,
  deleteKnowledgeSource,
} from "@/lib/automations.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Save, X, BookOpen, FileText, Globe, Database, MessageSquare, Tag, Settings } from "lucide-react";

interface KnowledgeSource {
  id: string;
  name: string;
  source_type: string;
  content: string;
  metadata: Record<string, unknown>;
  is_active: boolean;
}

export const Route = createFileRoute("/_authenticated/knowledge")({
  component: KnowledgePage,
});

function KnowledgePage() {
  const [editingSource, setEditingSource] = useState<KnowledgeSource | null>(null);
  const qc = useQueryClient();
  const listFn = useServerFn(listKnowledgeSources);
  const { data } = useQuery({ queryKey: ["knowledgeSources"], queryFn: () => listFn({}) });
  const sources = (data as { items?: KnowledgeSource[] })?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Base de Conocimiento</h1>
        <Button onClick={() => setEditingSource({ id: "", name: "", source_type: "faq", content: "", metadata: {}, is_active: true } as KnowledgeSource)}>
          <Plus className="h-4 w-4 mr-1" /> Nueva fuente
        </Button>
      </div>
      {editingSource && (
        <SourceEditor source={editingSource} onClose={() => { setEditingSource(null); qc.invalidateQueries({ queryKey: ["knowledgeSources"] }); }} />
      )}
      <div className="grid gap-3">
        {sources.map((s: KnowledgeSource) => (
          <SourceCard key={s.id} source={s} onEdit={() => setEditingSource(s)} />
        ))}
        {sources.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No hay fuentes de conocimiento. Crea una para que la IA pueda usarla.
          </Card>
        )}
      </div>
    </div>
  );
}

function SourceCard({ source, onEdit }: { source: KnowledgeSource; onEdit: () => void }) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteKnowledgeSource);
  const icon = sourceIcons[source.source_type] ?? <BookOpen className="h-4 w-4" />;

  return (
    <Card className="p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2 rounded-md bg-muted">{icon}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{source.name}</p>
            <Badge variant={source.is_active ? "default" : "secondary"} className="text-[10px]">
              {source.is_active ? "Activo" : "Inactivo"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">{sourceLabels[source.source_type] ?? source.source_type}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (!confirm("Eliminar fuente de conocimiento?")) return;
            await deleteFn({ data: { id: source.id } });
            qc.invalidateQueries({ queryKey: ["knowledgeSources"] });
          }}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </Card>
  );
}

const sourceLabels: Record<string, string> = {
  faq: "Preguntas Frecuentes",
  products: "Productos",
  services: "Servicios",
  catalog: "Catálogo",
  pdf_document: "Documento PDF",
  website: "Sitio Web",
  internal_kb: "Base de Conocimiento Interna",
  custom_prompt: "Prompt Personalizado",
};

const sourceIcons: Record<string, React.ReactNode> = {
  faq: <MessageSquare className="h-4 w-4" />,
  products: <Tag className="h-4 w-4" />,
  services: <Settings className="h-4 w-4" />,
  catalog: <BookOpen className="h-4 w-4" />,
  pdf_document: <FileText className="h-4 w-4" />,
  website: <Globe className="h-4 w-4" />,
  internal_kb: <Database className="h-4 w-4" />,
  custom_prompt: <MessageSquare className="h-4 w-4" />,
};

function SourceEditor({ source, onClose }: { source: KnowledgeSource; onClose: () => void }) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertKnowledgeSource);

  const [name, setName] = useState(source.name);
  const [sourceType, setSourceType] = useState(source.source_type);
  const [content, setContent] = useState(source.content);
  const [isActive, setIsActive] = useState(source.is_active);

  const saveSource = async () => {
    const res = await upsertFn({
      data: {
        id: source.id || undefined,
        name,
        source_type: sourceType,
        content,
        is_active: isActive,
        metadata: {},
      },
    });
    const saved = (res as any)?.item;
    if (saved) {
      toast.success("Fuente guardada");
      onClose();
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{source.id ? "Editar fuente" : "Nueva fuente"}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Preguntas frecuentes" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={sourceType} onValueChange={setSourceType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="faq">Preguntas Frecuentes</SelectItem>
              <SelectItem value="products">Productos</SelectItem>
              <SelectItem value="services">Servicios</SelectItem>
              <SelectItem value="catalog">Catálogo</SelectItem>
              <SelectItem value="pdf_document">Documento PDF</SelectItem>
              <SelectItem value="website">Sitio Web</SelectItem>
              <SelectItem value="internal_kb">Base de Conocimiento Interna</SelectItem>
              <SelectItem value="custom_prompt">Prompt Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Contenido</Label>
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Añade el contenido de la fuente de conocimiento..." rows={6} />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={isActive} onCheckedChange={setIsActive} />
        <Label className="text-xs">Activo</Label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={saveSource}>
          <Save className="h-4 w-4 mr-1" /> Guardar
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
          <X className="h-4 w-4 mr-1" /> Cancelar
        </Button>
      </div>
    </Card>
  );
}
