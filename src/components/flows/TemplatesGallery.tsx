import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFlowTemplates, createFromTemplate } from "@/lib/flows.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyPlus } from "lucide-react";
import { toast } from "sonner";
import { TRIGGERS } from "@/lib/flow-blocks";

export function TemplatesGallery({ onTemplateUsed }: { onTemplateUsed: (newFlowId: string) => void }) {
  const qc = useQueryClient();
  const listTemplatesFn = useServerFn(listFlowTemplates);
  const createFromTemplateFn = useServerFn(createFromTemplate);

  const { data } = useQuery({
    queryKey: ["flowTemplates"],
    queryFn: () => listTemplatesFn(),
  });

  const templates = (data as any)?.templates ?? [];

  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">Cargando plantillas...</p>;
  }

  const handleUseTemplate = async (templateId: string) => {
    try {
      const res = await createFromTemplateFn({ data: { templateId } });
      toast.success("Flujo creado desde plantilla");
      qc.invalidateQueries({ queryKey: ["flows"] });
      onTemplateUsed((res as any).flow.id);
    } catch (err: any) {
      toast.error(err.message || "Error al usar la plantilla");
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {templates.map((t: any) => {
        const triggerDef = TRIGGERS.find(tr => tr.id === t.trigger_type);
        const stepsCount = Array.isArray(t.steps) ? t.steps.length : 0;
        
        return (
          <Card key={t.id} className="p-4 flex flex-col justify-between h-full hover:border-primary/50 transition-colors">
            <div>
              <h3 className="font-semibold text-base mb-1">{t.name}</h3>
              <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                ⚡ {triggerDef ? triggerDef.label : t.trigger_type}
              </p>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs bg-secondary px-2 py-1 rounded-md font-medium">
                  {stepsCount} pasos preconfigurados
                </span>
              </div>
            </div>
            <Button className="w-full" variant="outline" onClick={() => handleUseTemplate(t.id)}>
              <CopyPlus className="h-4 w-4 mr-2" />
              Usar Plantilla
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
