import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TRIGGERS } from "@/lib/flow-blocks";

export function TriggerSelector({
  value,
  onChange,
  triggerValue,
  onTriggerValueChange
}: {
  value: string;
  onChange: (v: string) => void;
  triggerValue: string;
  onTriggerValueChange: (v: string) => void;
}) {
  const selectedDef = TRIGGERS.find(t => t.id === value);
  const needsValue = selectedDef?.needsValue;

  const groups = [
    { label: "WhatsApp", keys: ["whatsapp"] },
    { label: "CRM & Etiquetas", keys: ["crm"] },
    { label: "Mapleads", keys: ["mapleads"] },
    { label: "Ventas & IA", keys: ["sales", "ai"] },
    { label: "Sistema", keys: ["system"] },
  ];

  return (
    <div className="space-y-4 border rounded-md p-4 bg-muted/20">
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">¿Cuándo debe iniciar este flujo?</Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecciona un disparador" />
          </SelectTrigger>
          <SelectContent>
            {groups.map(g => (
              <SelectGroup key={g.label}>
                <SelectLabel>{g.label}</SelectLabel>
                {TRIGGERS.filter(t => g.keys.includes(t.group)).map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {needsValue && (
        <div className="pt-2 animate-in fade-in zoom-in duration-200">
          <Label className="text-xs text-muted-foreground mb-1 block">
            {value.includes("tag") ? "Nombre exacto o UUID de la etiqueta" : 
             value.includes("stage") ? "UUID de la etapa" : 
             value.includes("pipeline") ? "UUID del pipeline" : "Valor específico"}
          </Label>
          <Input 
            value={triggerValue} 
            onChange={(e) => onTriggerValueChange(e.target.value)} 
            placeholder="Ej. Interesado" 
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}
