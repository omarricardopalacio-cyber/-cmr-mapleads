import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { WAIT_UNITS } from "@/lib/flow-blocks";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export function StepConfigPanel({
  step,
  onChange,
  onSave
}: {
  step: any;
  onChange: (updates: any) => void;
  onSave?: () => void;
}) {
  if (!step) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-6 text-center">
        Selecciona un paso en el lienzo para configurarlo.
      </div>
    );
  }

  const type = step.step_type;
  const data = step.step_data || {};

  const updateData = (key: string, val: any) => {
    onChange({ step_data: { ...data, [key]: val } });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex-shrink-0 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Configuración del Paso</h3>
          <p className="text-xs text-muted-foreground">ID: {step.id?.split("-")[0]}...</p>
        </div>
        {onSave && (
          <Button size="sm" onClick={onSave} className="h-8">
            <Check className="h-4 w-4 mr-1" />
            Ok
          </Button>
        )}
      </div>

      <div className="p-4 overflow-y-auto flex-1 space-y-4">
        {type === "send_text" && (
          <div className="space-y-2">
            <Label>Mensaje de texto</Label>
            <Textarea 
              value={data.text || ""} 
              onChange={e => updateData("text", e.target.value)}
              placeholder="Hola, ¿cómo estás?"
              rows={5}
            />
          </div>
        )}

        {(type === "send_image" || type === "send_video" || type === "send_document") && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>URL del Archivo</Label>
              <Input 
                value={data.media_url || ""} 
                onChange={e => updateData("media_url", e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="space-y-2">
              <Label>Pie de foto (Caption)</Label>
              <Input 
                value={data.caption || ""} 
                onChange={e => updateData("caption", e.target.value)}
                placeholder="Opcional"
              />
            </div>
            {type === "send_document" && (
              <div className="space-y-2">
                <Label>Nombre de archivo (Mime Type)</Label>
                <Input 
                  value={data.mime_type || ""} 
                  onChange={e => updateData("mime_type", e.target.value)}
                  placeholder="documento.pdf"
                />
              </div>
            )}
          </div>
        )}

        {type === "wait" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Cantidad</Label>
              <Input 
                type="number" 
                value={data.amount || 1} 
                onChange={e => updateData("amount", Number(e.target.value))}
                min={1}
              />
            </div>
            <div className="space-y-2">
              <Label>Unidad</Label>
              <Select value={data.unit || "minutes"} onValueChange={v => updateData("unit", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WAIT_UNITS.map(u => (
                    <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {type === "add_tag" || type === "tag_add" || type === "remove_tag" || type === "tag_remove" || type === "if_has_tag" || type === "if_not_has_tag" ? (
          <div className="space-y-2">
            <Label>ID de Etiqueta (UUID)</Label>
            <Input 
              value={data.tag_id || data.tagId || ""} 
              onChange={e => updateData("tag_id", e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </div>
        ) : null}

        {type === "pipeline_move" && (
          <div className="space-y-2">
            <Label>ID de Etapa (Stage UUID)</Label>
            <Input 
              value={data.stage_id || ""} 
              onChange={e => updateData("stage_id", e.target.value)}
            />
          </div>
        )}

        {type === "assign_user" && (
          <div className="space-y-2">
            <Label>ID de Usuario (UUID)</Label>
            <Input 
              value={data.user_id || ""} 
              onChange={e => updateData("user_id", e.target.value)}
            />
          </div>
        )}

        {type === "note_create" && (
          <div className="space-y-2">
            <Label>Contenido de la nota</Label>
            <Textarea 
              value={data.text || ""} 
              onChange={e => updateData("text", e.target.value)}
              rows={3}
            />
          </div>
        )}

        {type === "toggle_ai" && (
          <div className="flex items-center gap-2">
            <Switch 
              checked={data.ai_enabled !== false} 
              onCheckedChange={v => updateData("ai_enabled", v)} 
            />
            <Label>IA Activada</Label>
          </div>
        )}

        {type === "goto_flow" && (
          <div className="space-y-2">
            <Label>ID del Flujo Destino</Label>
            <Input 
              value={data.flow_id || ""} 
              onChange={e => updateData("flow_id", e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </div>
        )}

        {type === "if_replied" && (
          <div className="p-3 bg-blue-50/50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 text-xs rounded-md border border-blue-200 dark:border-blue-800">
            Esta condición evalúa si el contacto ha respondido desde la última vez que el flujo estuvo inactivo (por un paso de "espera").
            Asegúrate de colocar un paso de <strong>Espera</strong> inmediatamente antes de esta condición para darle tiempo al cliente de responder.
          </div>
        )}
      </div>
    </div>
  );
}
