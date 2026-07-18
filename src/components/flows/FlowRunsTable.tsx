import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFlowRuns, updateRunStatus } from "@/lib/flows.functions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Play, Pause, XCircle } from "lucide-react";

export function FlowRunsTable({ flowId }: { flowId: string }) {
  const qc = useQueryClient();
  const listRunsFn = useServerFn(listFlowRuns);
  const updateStatusFn = useServerFn(updateRunStatus);

  const { data } = useQuery({
    queryKey: ["flowRuns", flowId],
    queryFn: () => listRunsFn({ data: { flowId } }),
    refetchInterval: 5000, // Refrescar cada 5s
  });

  const runs = (data as any)?.runs ?? [];

  if (runs.length === 0) {
    return <div className="p-4 text-center text-sm text-muted-foreground">No hay ejecuciones registradas.</div>;
  }

  const handleStatusChange = async (runId: string, status: "paused" | "active" | "cancelled") => {
    await updateStatusFn({ data: { runId, status } });
    qc.invalidateQueries({ queryKey: ["flowRuns", flowId] });
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Contacto</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Paso Actual</TableHead>
            <TableHead>Próxima Ejecución</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run: any) => {
            const isFinished = run.status === "completed" || run.status === "cancelled";
            const isPaused = run.status === "paused";
            const contactName = run.contacts?.display_name || run.contacts?.phone || run.contacts?.wa_id || "Desconocido";

            return (
              <TableRow key={run.id}>
                <TableCell className="font-medium">{contactName}</TableCell>
                <TableCell>
                  <Badge variant={run.status === "completed" ? "outline" : run.status === "cancelled" || run.status === "paused" ? "destructive" : "default"}>
                    {run.status === "wait_node" ? "esperando" : run.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {run.flow_steps?.step_type || "-"}
                </TableCell>
                <TableCell>
                  {isFinished ? (
                    <span className="text-muted-foreground">-</span>
                  ) : run.next_execution_at ? (
                    format(new Date(run.next_execution_at), "dd MMM HH:mm", { locale: es })
                  ) : "-"}
                </TableCell>
                <TableCell className="text-right">
                  {!isFinished && (
                    <div className="flex items-center justify-end gap-1">
                      {isPaused ? (
                        <Button variant="ghost" size="icon" onClick={() => handleStatusChange(run.id, "active")} title="Reanudar">
                          <Play className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" onClick={() => handleStatusChange(run.id, "paused")} title="Pausar">
                          <Pause className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleStatusChange(run.id, "cancelled")} title="Cancelar">
                        <XCircle className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
