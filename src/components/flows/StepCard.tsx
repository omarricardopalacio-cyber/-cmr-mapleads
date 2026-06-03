import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { STEPS } from "@/lib/flow-blocks";
import { Button } from "@/components/ui/button";
import { Trash2, GripVertical } from "lucide-react";
import * as LucideIcons from "lucide-react";

export function StepCard({
  step,
  isSelected,
  onSelect,
  onDelete
}: {
  step: any;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 1,
  };

  const stepDef = STEPS.find(s => s.id === step.step_type) || {
    label: step.step_type,
    icon: "Settings",
    isCondition: false
  };

  const IconComponent = (LucideIcons as any)[stepDef.icon] || LucideIcons.Zap;

  // Render a tiny summary based on type
  const renderSummary = () => {
    const data = step.step_data || {};
    if (step.step_type === "send_text") return data.text ? `"${data.text.slice(0, 30)}${data.text.length > 30 ? "..." : ""}"` : "Sin mensaje configurado";
    if (step.step_type === "wait") return `Esperar ${data.amount || 1} ${data.unit || "minutes"}`;
    if (step.step_type === "add_tag" || step.step_type === "remove_tag") return data.tag_id ? `Tag ID: ${data.tag_id.slice(0, 8)}...` : "Sin etiqueta configurada";
    if (step.step_type === "toggle_ai") return data.ai_enabled ? "Activar IA" : "Desactivar IA";
    if (step.step_type === "goto_flow") return data.flow_id ? `Flujo: ${data.flow_id.slice(0, 8)}...` : "Sin flujo seleccionado";
    return "";
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-md border ${isSelected ? "border-primary shadow-sm ring-1 ring-primary" : "border-border shadow-sm"} bg-card transition-colors`}
      onClick={onSelect}
    >
      <div className="flex items-stretch">
        <div
          {...attributes}
          {...listeners}
          className="flex items-center justify-center w-8 border-r bg-muted/30 cursor-grab hover:bg-muted/50 text-muted-foreground"
        >
          <GripVertical className="h-4 w-4" />
        </div>
        
        <div className="flex-1 p-3 flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2 rounded-md shrink-0 ${stepDef.isCondition ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-500" : "bg-primary/10 text-primary"}`}>
              <IconComponent className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-medium truncate">{stepDef.label}</h4>
              <p className="text-xs text-muted-foreground truncate">{renderSummary()}</p>
            </div>
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 ml-2"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {/* Branch Indicators para nodos dentro de un if */}
      {step.branch && (
        <div className={`absolute -top-3 left-4 px-2 py-0.5 rounded-full text-[10px] font-bold ${
          step.branch === "yes" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
        }`}>
          Rama: {step.branch === "yes" ? "Sí" : "No"}
        </div>
      )}
    </div>
  );
}
