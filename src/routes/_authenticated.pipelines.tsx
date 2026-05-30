import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPipelineStages, updateContactStage, listContacts } from "@/lib/crm.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, ChevronRight, Phone } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pipelines")({
  component: PipelinesPage,
});

interface PipelineStage {
  id: string;
  name: string;
  color: string;
  position: number;
}

interface Contact {
  id: string;
  display_name?: string | null;
  phone?: string | null;
  wa_id?: string | null;
  pipeline_stage_id?: string | null;
  contact_tags?: Array<{ tags?: { id: string; name: string; color: string } }>;
}

function PipelinesPage() {
  const qc = useQueryClient();
  const stagesFn = useServerFn(getPipelineStages);
  const contactsFn = useServerFn(listContacts);
  const updateFn = useServerFn(updateContactStage);

  const { data: stagesData } = useQuery({
    queryKey: ["pipelineStages"],
    queryFn: () => stagesFn({}),
  });

  const { data: contactsData } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => contactsFn({}),
  });

  const stages: PipelineStage[] = stagesData?.stages ?? [];
  const contacts: Contact[] = (contactsData?.contacts ?? []) as unknown as Contact[];

  const moveMut = useMutation({
    mutationFn: ({ contactId, stageId }: { contactId: string; stageId: string | null }) =>
      updateFn({ data: { contactId, stageId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contacto movido");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sortedStages = [...stages].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-4 h-[calc(100vh-6rem)]">
      <div>
        <h1 className="text-2xl font-semibold">Embudo de Ventas</h1>
        <p className="text-muted-foreground text-sm">Mueve contactos entre etapas usando las flechas.</p>
      </div>
      <div className="grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${Math.max(sortedStages.length, 1)}, minmax(260px, 1fr))` }}>
        {sortedStages.map((stage) => {
          const stageContacts = contacts.filter((c) => c.pipeline_stage_id === stage.id);
          const stageIndex = sortedStages.findIndex((s) => s.id === stage.id);
          const prevStage = sortedStages[stageIndex - 1];
          const nextStage = sortedStages[stageIndex + 1];
          return (
            <div key={stage.id} className="flex flex-col min-w-[260px]">
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-t-lg text-sm font-medium text-white"
                style={{ backgroundColor: stage.color }}
              >
                <span>{stage.name}</span>
                <Badge variant="secondary" className="text-[10px] h-5 bg-white/20 text-white border-0">
                  {stageContacts.length}
                </Badge>
              </div>
              <ScrollArea className="flex-1 border-x border-b rounded-b-lg bg-muted/20 p-2 min-h-[400px]">
                <div className="space-y-2">
                  {stageContacts.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-8">Sin contactos</div>
                  )}
                  {stageContacts.map((c) => {
                    const label = c.display_name || c.phone || c.wa_id || "Contacto";
                    const tags = (c.contact_tags ?? [])
                      .filter((x) => x?.tags)
                      .map((x) => x.tags!);
                    return (
                      <Card key={c.id} className="p-2 shadow-sm">
                        <CardContent className="p-0 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium shrink-0">
                              {label.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{label}</div>
                              <div className="text-[10px] text-muted-foreground font-mono truncate flex items-center gap-1">
                                <Phone className="h-2.5 w-2.5" />
                                {c.phone || c.wa_id || "—"}
                              </div>
                            </div>
                          </div>
                          {tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {tags.map((tag) => (
                                <span
                                  key={tag.id}
                                  className="text-[9px] px-1 py-0.5 rounded-full border"
                                  style={{ borderColor: tag.color, color: tag.color, backgroundColor: `${tag.color}15` }}
                                >
                                  {tag.name}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex justify-between pt-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              disabled={!prevStage || moveMut.isPending}
                              onClick={() => prevStage && moveMut.mutate({ contactId: c.id, stageId: prevStage.id })}
                            >
                              <ChevronLeft className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              disabled={!nextStage || moveMut.isPending}
                              onClick={() => nextStage && moveMut.mutate({ contactId: c.id, stageId: nextStage.id })}
                            >
                              <ChevronRight className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          );
        })}
      </div>
    </div>
  );
}
