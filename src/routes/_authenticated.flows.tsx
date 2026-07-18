import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listFlows } from "@/lib/flows.functions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, LayoutTemplate } from "lucide-react";
import { FlowList } from "@/components/flows/FlowList";
import { FlowEditor } from "@/components/flows/FlowEditor";
import { TemplatesGallery } from "@/components/flows/TemplatesGallery";

export const Route = createFileRoute("/_authenticated/flows")({
  component: FlowsPage,
});

function FlowsPage() {
  const [editingFlow, setEditingFlow] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  
  const listFn = useServerFn(listFlows);
  const { data } = useQuery({ 
    queryKey: ["flows"], 
    queryFn: () => listFn() 
  });
  
  const flows = (data as any)?.flows ?? [];

  if (editingFlow) {
    return <FlowEditor flowId={editingFlow} onClose={() => setEditingFlow(null)} />;
  }

  const activeFlows = flows.filter((f: any) => f.is_active);
  const draftFlows = flows.filter((f: any) => !f.is_active);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Flujos Automatizados</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Diseña secuencias automáticas de mensajes, etiquetas y acciones CRM.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setActiveTab("templates")}>
            <LayoutTemplate className="h-4 w-4 mr-2" />
            Plantillas
          </Button>
          <Button onClick={() => setEditingFlow("new")}>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo flujo en blanco
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="all">Todos ({flows.length})</TabsTrigger>
          <TabsTrigger value="active">Activos ({activeFlows.length})</TabsTrigger>
          <TabsTrigger value="drafts">Borradores ({draftFlows.length})</TabsTrigger>
          <TabsTrigger value="templates">Plantillas</TabsTrigger>
        </TabsList>
        
        <TabsContent value="all" className="mt-0 outline-none">
          <FlowList flows={flows} onEdit={setEditingFlow} />
        </TabsContent>
        
        <TabsContent value="active" className="mt-0 outline-none">
          <FlowList flows={activeFlows} onEdit={setEditingFlow} />
        </TabsContent>
        
        <TabsContent value="drafts" className="mt-0 outline-none">
          <FlowList flows={draftFlows} onEdit={setEditingFlow} />
        </TabsContent>
        
        <TabsContent value="templates" className="mt-0 outline-none">
          <TemplatesGallery onTemplateUsed={(id) => setEditingFlow(id)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
