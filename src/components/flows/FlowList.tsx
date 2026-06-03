import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { GitBranch, Sparkles, Trash2 } from "lucide-react";
import { setFlowActive, deleteFlow } from "@/lib/flows.functions";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { TRIGGERS } from "@/lib/flow-blocks";

export function FlowList({ flows, onEdit }: { flows: any[]; onEdit: (id: string) => void }) {
  const qc = useQueryClient();
  const setActiveFn = useServerFn(setFlowActive);
  const deleteFn = useServerFn(deleteFlow);

  if (flows.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No hay flujos en esta categoría.
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {flows.map((flow) => {
        const triggerDef = TRIGGERS.find(t => t.id === flow.trigger_type);
        const triggerLabel = triggerDef ? triggerDef.label : flow.trigger_type;

        return (
          <Card key={flow.id} className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="p-2 rounded-md bg-muted shrink-0">
                <GitBranch className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-base font-medium truncate">{flow.name}</p>
                  <Badge variant={flow.is_active ? "default" : "secondary"} className="text-[10px]">
                    {flow.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                  {flow.active_runs > 0 && (
                    <Badge variant="outline" className="text-[10px] text-blue-500 border-blue-500">
                      {flow.active_runs} ejecutándose
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate flex items-center gap-2">
                  <span>⚡ {triggerLabel}</span>
                  {flow.trigger_value && (
                    <span className="bg-muted px-1.5 py-0.5 rounded-sm text-xs font-mono">{flow.trigger_value}</span>
                  )}
                </p>
                {flow.description && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">{flow.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
              <div className="flex items-center gap-2 border-r pr-3">
                <span className="text-xs text-muted-foreground">Activo</span>
                <Switch
                  checked={flow.is_active}
                  onCheckedChange={async (v) => {
                    await setActiveFn({ data: { id: flow.id, is_active: v } });
                    qc.invalidateQueries({ queryKey: ["flows"] });
                  }}
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => onEdit(flow.id)}>
                <Sparkles className="h-4 w-4 mr-2" /> Editar
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={async () => {
                  if (!confirm("¿Seguro que deseas eliminar este flujo?")) return;
                  await deleteFn({ data: { id: flow.id } });
                  qc.invalidateQueries({ queryKey: ["flows"] });
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
