import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFlow, upsertFlow, listFlowSteps, upsertSteps, runFlowManually, listContactsLite } from "@/lib/flows.functions";
import { STEPS } from "@/lib/flow-blocks";
import { FlowCanvas } from "./FlowCanvas";
import { TriggerSelector } from "./TriggerSelector";
import { StepConfigPanel } from "./StepConfigPanel";
import { FlowRunsTable } from "./FlowRunsTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Save, ArrowLeft, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function FlowEditor({ flowId, onClose }: { flowId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const getFlowFn = useServerFn(getFlow);
  const upsertFlowFn = useServerFn(upsertFlow);
  const listStepsFn = useServerFn(listFlowSteps);
  const upsertStepsFn = useServerFn(upsertSteps);
  const runFlowManuallyFn = useServerFn(runFlowManually);
  const listContactsLiteFn = useServerFn(listContactsLite);

  const isNew = flowId === "new";

  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  const { data: contactsData } = useQuery({
    queryKey: ["contactsLite"],
    queryFn: () => listContactsLiteFn({}),
    enabled: !isNew,
  });

  const contacts = (contactsData as any)?.contacts ?? [];
  const filteredContacts = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((contact: any) => {
      return [contact.display_name, contact.phone, contact.wa_id]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(query));
    });
  }, [contactQuery, contacts]);

  const { data: flowData } = useQuery({
    queryKey: ["flow", flowId],
    queryFn: () => getFlowFn({ data: { id: flowId } }),
    enabled: !isNew,
  });

  const { data: stepsData } = useQuery({
    queryKey: ["flowSteps", flowId],
    queryFn: () => listStepsFn({ data: { flowId } }),
    enabled: !isNew,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState("manual");
  const [triggerValue, setTriggerValue] = useState("");
  const [steps, setSteps] = useState<any[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  // Sync state when data loads
  useEffect(() => {
    if (flowData && (flowData as any).flow) {
      const f = (flowData as any).flow;
      setName(f.name || "");
      setDescription(f.description || "");
      setTriggerType(f.trigger_type || "manual");
      setTriggerValue(f.trigger_value || "");
    }
  }, [flowData]);

  useEffect(() => {
    if (stepsData && (stepsData as any).steps) {
      setSteps((stepsData as any).steps);
    }
  }, [stepsData]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("El flujo debe tener un nombre");
      return;
    }

    try {
      // 1. Guardar metadatos del flujo
      const res = await upsertFlowFn({
        data: {
          id: isNew ? undefined : flowId,
          name,
          description,
          trigger_type: triggerType,
          trigger_value: triggerValue || null,
        }
      });
      
      const savedFlowId = (res as any).flow.id;

      // 2. Guardar pasos (incluyendo el caso de borrar todos los pasos existentes)
      await upsertStepsFn({
        data: {
          flowId: savedFlowId,
          steps: steps.map((s, i) => {
            const normalizedStep: any = {
              ...s,
              step_order: i + 1,
            };

            if (!normalizedStep.id || normalizedStep.id.startsWith("temp-")) {
              delete normalizedStep.id;
            }

            return normalizedStep;
          })
        }
      });

      toast.success("Flujo guardado exitosamente");
      qc.invalidateQueries({ queryKey: ["flows"] });
      if (isNew) {
        onClose(); // Volver al listado para refrescar
      } else {
        qc.invalidateQueries({ queryKey: ["flowSteps", savedFlowId] });
      }
    } catch (err: any) {
      toast.error(err.message || "Error al guardar el flujo");
    }
  };

  const selectedStep = steps.find(s => s.id === selectedStepId);
  const branchSteps = selectedStepId ? steps.filter((s) => s.parent_step_id === selectedStepId) : [];

  const addStepToBranch = (stepType: string, branch: "yes" | "no") => {
    if (!selectedStepId) return;
    const def = STEPS.find((s) => s.id === stepType);
    if (!def) return;

    const newId = `temp-${Date.now()}-${branch}`;
    const newStep = {
      id: newId,
      step_type: stepType,
      step_order: steps.length + 1,
      step_data: { ...def.defaultConfig },
      parent_step_id: selectedStepId,
      branch,
    };

    setSteps([...steps, newStep]);
    setSelectedStepId(newId);
  };

  const handleRunManual = async () => {
    if (!selectedContactId) {
      toast.error("Selecciona un contacto para ejecutar el flujo");
      return;
    }

    try {
      await runFlowManuallyFn({ data: { flowId, contactId: selectedContactId } });
      toast.success("Flujo ejecutado manualmente");
      setManualDialogOpen(false);
      setContactQuery("");
      setSelectedContactId(null);
    } catch (err: any) {
      toast.error(err.message || "Error al ejecutar el flujo");
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] bg-background rounded-lg border shadow-sm overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b shrink-0 bg-muted/20">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <Input 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder="Nombre del flujo..." 
              className="font-bold text-lg h-9 border-transparent hover:border-input focus-visible:ring-1 bg-transparent px-2 -ml-2 w-75"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <Dialog open={manualDialogOpen} onOpenChange={(open) => {
              setManualDialogOpen(open);
              if (!open) {
                setContactQuery("");
                setSelectedContactId(null);
              }
            }}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <PlayCircle className="h-4 w-4 mr-2 text-primary" />
                  Probar Flujo
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Ejecutar flujo manualmente</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                  <p className="text-sm text-muted-foreground">Selecciona un contacto para ejecutar este flujo inmediatamente.</p>
                  <Input
                    placeholder="Buscar por nombre, teléfono o WA ID..."
                    value={contactQuery}
                    onChange={(e) => setContactQuery(e.target.value)}
                  />
                  <div className="max-h-48 overflow-y-auto rounded-md border bg-background p-2">
                    {filteredContacts.length > 0 ? (
                      filteredContacts.slice(0, 10).map((contact: any) => (
                        <button
                          key={contact.id}
                          type="button"
                          className={`block w-full text-left rounded-md px-3 py-2 text-sm ${selectedContactId === contact.id ? "bg-primary text-white" : "hover:bg-muted/50"}`}
                          onClick={() => setSelectedContactId(contact.id)}
                        >
                          <div className="font-medium">{contact.display_name || contact.wa_id || contact.phone}</div>
                          <div className="text-xs text-muted-foreground">{contact.phone || contact.wa_id}</div>
                        </button>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">No se encontraron contactos.</div>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setManualDialogOpen(false)}>Cancelar</Button>
                    <Button onClick={handleRunManual} disabled={!selectedContactId}>
                      Ejecutar
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
          <Button onClick={handleSave} size="sm">
            <Save className="h-4 w-4 mr-2" />
            Guardar
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Panel Izquierdo (Disparador + Meta) */}
        <div className="w-80 border-r hidden md:flex md:flex-col bg-muted/10 shrink-0 overflow-y-auto">
          <div className="p-4 space-y-6">
            <TriggerSelector 
              value={triggerType} 
              onChange={setTriggerType}
              triggerValue={triggerValue}
              onTriggerValueChange={setTriggerValue}
            />

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Descripción (opcional)</Label>
              <Textarea 
                value={description} 
                onChange={(e) => setDescription(e.target.value)} 
                rows={3} 
                className="resize-none text-sm"
                placeholder="¿Qué hace este flujo?"
              />
            </div>
          </div>
        </div>

        {/* Centro (Canvas + Tabs) */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50/50 dark:bg-slate-900/20">
          <Tabs defaultValue="editor" className="flex-1 flex flex-col">
            <div className="border-b px-4 bg-background">
              <TabsList className="bg-transparent border-b-0 h-12 space-x-4">
                <TabsTrigger value="editor" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 h-12">Editor Visual</TabsTrigger>
                {!isNew && (
                  <TabsTrigger value="runs" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 h-12">Ejecuciones</TabsTrigger>
                )}
              </TabsList>
            </div>

            <TabsContent value="editor" className="flex-1 overflow-hidden m-0 outline-none">
              <div className="flex h-full overflow-hidden">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <FlowCanvas 
                    steps={steps} 
                    onStepsChange={setSteps} 
                    selectedStepId={selectedStepId}
                    onSelectStep={setSelectedStepId}
                  />
                </div>
                <aside className="w-80 border-l bg-background shrink-0 hidden lg:flex flex-col overflow-hidden">
                  <div className="border-b px-4 py-3">
                    <div className="text-sm font-semibold">Pasos del flujo</div>
                    <div className="text-xs text-muted-foreground">Selecciona un paso para verlo y desplazarte fácilmente.</div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {steps.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No hay pasos aún. Añade un paso para comenzar.</div>
                    ) : (
                      steps.map((step) => {
                        const stepMeta = STEPS.find((item) => item.id === step.step_type);
                        return (
                          <button
                            key={step.id}
                            type="button"
                            className={`w-full text-left rounded-xl border px-3 py-3 transition ${selectedStepId === step.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/70"}`}
                            onClick={() => setSelectedStepId(step.id)}
                          >
                            <div className="text-sm font-medium">{stepMeta?.label || step.step_type}</div>
                            <div className="text-xs text-muted-foreground">Paso #{step.step_order}</div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </aside>
              </div>
            </TabsContent>

            {!isNew && (
              <TabsContent value="runs" className="flex-1 overflow-y-auto m-0 p-4 outline-none bg-background">
                <FlowRunsTable flowId={flowId} />
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* Panel Derecho (Config Paso) */}
        <div className="w-80 border-l bg-background shrink-0 hidden lg:block overflow-hidden">
          <StepConfigPanel 
            step={selectedStep} 
            onChange={(updates) => {
              setSteps(steps.map(s => s.id === selectedStepId ? { ...s, ...updates } : s));
            }}
          />
        </div>
      </div>
    </div>
  );
}
