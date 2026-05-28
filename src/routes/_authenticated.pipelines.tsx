import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/pipelines")({
  component: PipelinesPage,
});

function PipelinesPage() {
  const cols = ["Nuevo", "En conversación", "Propuesta", "Ganado"];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Pipelines</h1>
      <p className="text-muted-foreground text-sm">Pipeline Kanban (próximamente — vista demo).</p>
      <div className="grid grid-cols-4 gap-3">
        {cols.map((c) => (
          <Card key={c} className="p-3 min-h-[400px]">
            <div className="font-medium mb-3">{c}</div>
            <div className="text-xs text-muted-foreground">Sin tarjetas</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
