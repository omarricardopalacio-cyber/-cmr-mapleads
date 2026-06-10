import { useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { StepCard } from "./StepCard";
import { Button } from "@/components/ui/button";
import { Plus, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { STEPS } from "@/lib/flow-blocks";
import * as LucideIcons from "lucide-react";

export function FlowCanvas({
  steps,
  onStepsChange,
  selectedStepId,
  onSelectStep
}: {
  steps: any[];
  onStepsChange: (steps: any[]) => void;
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = steps.findIndex(s => s.id === active.id);
      const newIndex = steps.findIndex(s => s.id === over.id);
      
      const newSteps = arrayMove(steps, oldIndex, newIndex).map((s, index) => ({
        ...s,
        step_order: index + 1
      }));
      
      onStepsChange(newSteps);
    }
  };

  const addStep = (stepType: string) => {
    const def = STEPS.find(s => s.id === stepType);
    if (!def) return;

    const newId = `temp-${Date.now()}`;
    const newStep = {
      id: newId,
      step_type: stepType,
      step_order: steps.length + 1,
      step_data: { ...def.defaultConfig },
      parent_step_id: null,
      branch: null
    };

    onStepsChange([...steps, newStep]);
    onSelectStep(newId);
  };

  const deleteStep = (id: string) => {
    // Si eliminamos un paso condicional, deberíamos eliminar sus hijos también
    // Para esta versión simplificada, simplemente lo eliminamos.
    const newSteps = steps.filter(s => s.id !== id).map((s, index) => ({
      ...s,
      step_order: index + 1
    }));
    onStepsChange(newSteps);
    if (selectedStepId === id) onSelectStep(null);
  };

  // Agrupamos pasos para el menú
  const groups = [
    { label: "Comunicación", category: "comunicacion" },
    { label: "Tiempo", category: "tiempo" },
    { label: "CRM & Etiquetas", category: "crm" },
    { label: "Inteligencia Artificial", category: "ia" },
    { label: "Condicionales", category: "condicionales" },
    { label: "Navegación", category: "navegacion" },
  ];

  return (
    <div className="flex flex-col items-center max-w-2xl mx-auto py-8 px-4 h-full min-h-0 overflow-hidden">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <div className="w-full flex-1 min-h-0 overflow-y-auto space-y-4">
            {steps.length === 0 ? (
              <div className="text-center p-8 border border-dashed rounded-xl bg-muted/10">
                <p className="text-muted-foreground mb-4">El flujo está vacío</p>
              </div>
            ) : (
              steps.map((step, index) => (
                <div key={step.id} className="relative">
                  <StepCard
                    step={step}
                    isSelected={selectedStepId === step.id}
                    onSelect={() => onSelectStep(step.id)}
                    onDelete={() => deleteStep(step.id)}
                  />
                  {index < steps.length - 1 && (
                    <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-px h-4 bg-border z-0" />
                  )}
                </div>
              ))
            )}
            
            {/* Botón para añadir pasos */}
            <div className="relative pt-4 flex justify-center">
              {steps.length > 0 && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-4 bg-border z-0" />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="rounded-full shadow-sm bg-background relative z-10">
                    <Plus className="h-4 w-4 mr-2" />
                    Añadir Paso
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64" align="center">
                  {groups.map((g, i) => {
                    const groupSteps = STEPS.filter(s => s.category === g.category);
                    if (groupSteps.length === 0) return null;
                    
                    return (
                      <DropdownMenuGroup key={g.category}>
                        <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
                        {groupSteps.map(s => {
                          const IconComp = (LucideIcons as any)[s.icon] || LucideIcons.Zap;
                          return (
                            <DropdownMenuItem key={s.id} onClick={() => addStep(s.id)}>
                              <IconComp className="h-4 w-4 mr-2 text-muted-foreground" />
                              {s.label}
                            </DropdownMenuItem>
                          );
                        })}
                        {i < groups.length - 1 && <DropdownMenuSeparator />}
                      </DropdownMenuGroup>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
