// @ts-nocheck
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { WAIT_UNITS } from "@/lib/flow-blocks";
import { uploadMedia } from "@/lib/upload-media";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { listTags, createTag } from "@/lib/tags.functions";
import { listFlows } from "@/lib/flows.functions";
import { searchCatalogProducts } from "@/lib/catalog.functions";

export function StepConfigPanel({
  step,
  branchSteps,
  onAddBranchStep,
  onBranchChange,
  onBranchDelete,
  onChange,
  onSave
}: {
  step: any;
  branchSteps?: any[];
  onAddBranchStep?: (stepType: string, branch: "yes" | "no") => void;
  onBranchChange?: (branchStepId: string, updates: any) => void;
  onBranchDelete?: (branchStepId: string) => void;
  onChange: (updates: any) => void;
  onSave?: () => void;
}) {
  if (!step) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-6 text-center">
        Selecciona un paso en el lienzo para configurarlo.
      </div>
    );
  }

  const type = step.step_type;
  const data = step.step_data || {};

  const updateData = (key: string, val: any) => {
    onChange({ step_data: { ...data, [key]: val } });
  };

  const qc = useQueryClient();
  const listTagsFn = useServerFn(listTags);
  const createTagFn = useServerFn(createTag);
  const listFlowsFn = useServerFn(listFlows);
  const searchProductsFn = useServerFn(searchCatalogProducts);

  const { data: tagsData, isLoading: tagsLoading } = useQuery({
    queryKey: ["flowStepTags"],
    queryFn: () => listTagsFn(),
  });

  const { data: flowsData } = useQuery({
    queryKey: ["flowListForStep"],
    queryFn: () => listFlowsFn(),
  });

  const [newTagName, setNewTagName] = useState("");
  const [productQuery, setProductQuery] = useState("");

  const { data: productSearchData } = useQuery({
    queryKey: ["stepProductSearch", productQuery],
    queryFn: () => searchProductsFn({ data: { q: productQuery, limit: 12 } }),
    enabled: productQuery.trim().length > 0,
  });

  const tags = tagsData?.tags ?? [];
  const flows = flowsData?.flows ?? [];
  const products = productSearchData?.products ?? [];
  const selectedProduct = products.find((product) => product.id === data.product_id);

  const isConditionalType = ["if_has_tag", "if_not_has_tag", "if_replied", "if_bought"].includes(type);
  const branchActionOptions = [
    { id: "tag_add", label: "Poner etiqueta" },
    { id: "tag_remove", label: "Quitar etiqueta" },
    { id: "goto_flow", label: "Ir a otro flujo" },
    { id: "ai_enable", label: "Activar IA" },
    { id: "ai_disable", label: "Desactivar IA" },
    { id: "send_text", label: "Enviar mensaje" },
    { id: "send_video", label: "Enviar video" },
    { id: "send_image", label: "Enviar imagen" },
    { id: "send_catalog", label: "Enviar catálogo" },
    { id: "if_has_tag", label: "Condición: Tiene etiqueta" },
    { id: "if_not_has_tag", label: "Condición: No tiene etiqueta" },
    { id: "if_replied", label: "Condición: Respondió" },
  ];
  const branchYesSteps = (branchSteps ?? []).filter((s) => s.branch === "yes");
  const branchNoSteps = (branchSteps ?? []).filter((s) => s.branch === "no");
  const [branchSelection, setBranchSelection] = useState({ yes: "", no: "" });

  const handleAddBranchStep = (stepType: string, branch: "yes" | "no") => {
    if (!stepType) return;
    onAddBranchStep?.(stepType, branch);
    setBranchSelection((prev) => ({ ...prev, [branch]: "" }));
  };

  const updateBranchStep = (stepId: string, key: string, value: any) => {
    const branchStep = (branchSteps ?? []).find((s) => s.id === stepId);
    if (!branchStep) return;
    onBranchChange?.(stepId, {
      ...branchStep,
      step_data: {
        ...branchStep.step_data,
        [key]: value,
      },
    });
  };

  const handleBranchFileUpload = async (stepId: string, file?: File) => {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const { url, mime_type } = await uploadMedia(file);
      const branchStep = (branchSteps ?? []).find((s) => s.id === stepId);
      if (!branchStep) return;
      onBranchChange?.(stepId, {
        ...branchStep,
        step_data: {
          ...branchStep.step_data,
          media_url: url,
          mime_type,
          caption: branchStep.step_data?.caption || file.name,
        },
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const renderBranchStepEditor = (branchStep: any) => {
    const branchData = branchStep.step_data || {};

    if (branchStep.step_type === "send_text") {
      return (
        <div className="space-y-2">
          <Label>Texto</Label>
          <Textarea
            value={branchData.text || ""}
            onChange={(e) => updateBranchStep(branchStep.id, "text", e.target.value)}
            placeholder="Escribe el mensaje que se enviará"
            rows={4}
          />
        </div>
      );
    }

    if (["send_image", "send_video", "send_catalog"].includes(branchStep.step_type)) {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>URL del archivo</Label>
            <Input
              value={branchData.media_url || ""}
              onChange={(e) => updateBranchStep(branchStep.id, "media_url", e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-2">
            <Label>Cargar archivo</Label>
            <input
              type="file"
              accept={branchStep.step_type === "send_image" ? "image/*" : branchStep.step_type === "send_video" ? "video/*" : "application/pdf"}
              disabled={uploading}
              onChange={(e) => handleBranchFileUpload(branchStep.id, e.target.files?.[0])}
              className="block w-full text-sm text-muted-foreground"
            />
            {uploadError ? <p className="text-xs text-destructive">{uploadError}</p> : null}
          </div>
          <div className="space-y-2">
            <Label>Pie de foto / mensaje</Label>
            <Input
              value={branchData.caption || ""}
              onChange={(e) => updateBranchStep(branchStep.id, "caption", e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </div>
      );
    }

    if (branchStep.step_type === "goto_flow") {
      return (
        <div className="space-y-2">
          <Label>Flujo destino</Label>
          <Select
            value={branchData.flow_id || ""}
            onValueChange={(v) => updateBranchStep(branchStep.id, "flow_id", v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un flujo" />
            </SelectTrigger>
            <SelectContent>
              {flows.map((flow) => (
                <SelectItem key={flow.id} value={flow.id}>{flow.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    if (["tag_add", "tag_remove", "if_has_tag", "if_not_has_tag"].includes(branchStep.step_type)) {
      return (
        <div className="space-y-2">
          <Label>Etiqueta</Label>
          <Select
            value={branchData.tag_id || branchData.tagId || ""}
            onValueChange={(v) => updateBranchStep(branchStep.id, "tag_id", v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona una etiqueta" />
            </SelectTrigger>
            <SelectContent>
              {tags.map((tag) => (
                <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    if (branchStep.step_type === "note_create") {
      return (
        <div className="space-y-2">
          <Label>Contenido de la nota</Label>
          <Textarea
            value={branchData.text || ""}
            onChange={(e) => updateBranchStep(branchStep.id, "text", e.target.value)}
            rows={3}
          />
        </div>
      );
    }

    if (branchStep.step_type === "wait") {
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Cantidad</Label>
            <Input
              type="number"
              value={branchData.amount || 1}
              onChange={(e) => updateBranchStep(branchStep.id, "amount", Number(e.target.value))}
              min={1}
            />
          </div>
          <div className="space-y-2">
            <Label>Unidad</Label>
            <Select value={branchData.unit || "minutes"} onValueChange={(v) => updateBranchStep(branchStep.id, "unit", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WAIT_UNITS.map((u) => (
                  <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    }

    return <p className="text-xs text-muted-foreground">Selecciona este paso en el lienzo para configurar sus detalles.</p>;
  };

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileUpload = async (file?: File) => {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const { url, mime_type } = await uploadMedia(file);
      // IMPORTANTE: batch en un solo onChange. Llamar updateData varias veces seguidas usa
      // un closure stale de `data`, de modo que la última llamada sobrescribe a las anteriores
      // y se PIERDE media_url. Esto causaba que imágenes/videos/catálogos no se enviaran.
      onChange({
        step_data: {
          ...data,
          media_url: url,
          mime_type,
          caption: data.caption || file.name,
        },
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    try {
      const result = await createTagFn({ data: { name, color: "#E0E0E0" } });
      qc.invalidateQueries(["flowStepTags"]);
      setNewTagName("");
      if (result?.tag?.id) {
        updateData("tag_id", result.tag.id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const acceptTypes = {
    send_image: "image/*",
    send_video: "video/*",
    send_document: "application/pdf",
    send_catalog: "application/pdf",
  } as const;

  const fileAccept = acceptTypes[type as keyof typeof acceptTypes] || "*";

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex-shrink-0 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Configuración del Paso</h3>
          <p className="text-xs text-muted-foreground">ID: {step.id?.split("-")[0]}...</p>
        </div>
        {onSave && (
          <Button size="sm" onClick={onSave} className="h-8">
            <Check className="h-4 w-4 mr-1" />
            Ok
          </Button>
        )}
      </div>

      <div className="p-4 overflow-y-auto flex-1 space-y-4">
        {type === "send_text" && (
          <div className="space-y-2">
            <Label>Mensaje de texto</Label>
            <Textarea 
              value={data.text || ""} 
              onChange={e => updateData("text", e.target.value)}
              placeholder="Hola, ¿cómo estás?"
              rows={5}
            />
          </div>
        )}

        {(type === "send_image" || type === "send_video" || type === "send_document" || type === "send_catalog") && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>URL del Archivo o Catálogo</Label>
              <Input 
                value={data.media_url || ""} 
                onChange={e => updateData("media_url", e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="space-y-2">
              <Label>Cargar archivo</Label>
              <input
                type="file"
                accept={fileAccept}
                disabled={uploading}
                onChange={e => handleFileUpload(e.target.files?.[0])}
                className="block w-full text-sm text-muted-foreground"
              />
              {uploadError ? <p className="text-xs text-destructive">{uploadError}</p> : null}
            </div>
            <div className="space-y-2">
              <Label>Pie de foto / mensaje</Label>
              <Input 
                value={data.caption || ""} 
                onChange={e => updateData("caption", e.target.value)}
                placeholder="Opcional"
              />
            </div>
            {(type === "send_document" || type === "send_catalog") && (
              <div className="space-y-2">
                <Label>Tipo MIME</Label>
                <Input 
                  value={data.mime_type || ""} 
                  onChange={e => updateData("mime_type", e.target.value)}
                  placeholder="application/pdf"
                />
              </div>
            )}
          </div>
        )}

        {type === "send_product" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Buscar producto del catálogo</Label>
              <Input
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="Nombre, SKU o descripción"
              />
            </div>
            <div className="space-y-2">
              <Label>Resultados</Label>
              {productQuery.trim().length === 0 ? (
                <p className="text-xs text-muted-foreground">Empieza a escribir para buscar productos.</p>
              ) : products.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {products.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => {
                        updateData("product_id", product.id);
                        setProductQuery(product.name || "");
                      }}
                      className="w-full text-left rounded-lg border p-3 hover:border-primary hover:bg-primary/5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{product.name}</span>
                        <span className="text-xs text-muted-foreground">{product.sku || ""}</span>
                      </div>
                      {product.price != null ? (
                        <p className="text-xs text-muted-foreground">Precio: ${product.price}</p>
                      ) : null}
                      {product.description ? (
                        <p className="text-xs text-muted-foreground line-clamp-2">{product.description}</p>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No se encontraron productos para esa búsqueda.</p>
              )}
            </div>
            {data.product_id ? (
              <div className="rounded-lg border bg-muted/5 p-3">
                <p className="text-xs text-muted-foreground">Producto seleccionado</p>
                <p className="font-medium break-words">{selectedProduct?.name || data.product_id}</p>
                {selectedProduct?.price != null ? (
                  <p className="text-xs text-muted-foreground">Precio: ${selectedProduct.price}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {type === "wait" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Cantidad</Label>
              <Input 
                type="number" 
                value={data.amount || 1} 
                onChange={e => updateData("amount", Number(e.target.value))}
                min={1}
              />
            </div>
            <div className="space-y-2">
              <Label>Unidad</Label>
              <Select value={data.unit || "minutes"} onValueChange={v => updateData("unit", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WAIT_UNITS.map(u => (
                    <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {type === "add_tag" || type === "tag_add" || type === "remove_tag" || type === "tag_remove" || type === "if_has_tag" || type === "if_not_has_tag" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Etiqueta</Label>
              <Select value={data.tag_id || data.tagId || ""} onValueChange={(v) => updateData("tag_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder={tagsLoading ? "Cargando etiquetas..." : "Selecciona una etiqueta"} />
                </SelectTrigger>
                <SelectContent>
                  {tags.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Crear nueva etiqueta</Label>
              <div className="flex gap-2">
                <Input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="Nombre de etiqueta"
                />
                <Button size="sm" onClick={handleCreateTag} className="whitespace-nowrap">
                  Crear
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {type === "pipeline_move" && (
          <div className="space-y-2">
            <Label>ID de Etapa (Stage UUID)</Label>
            <Input 
              value={data.stage_id || ""} 
              onChange={e => updateData("stage_id", e.target.value)}
            />
          </div>
        )}

        {type === "assign_user" && (
          <div className="space-y-2">
            <Label>ID de Usuario (UUID)</Label>
            <Input 
              value={data.user_id || ""} 
              onChange={e => updateData("user_id", e.target.value)}
            />
          </div>
        )}

        {type === "note_create" && (
          <div className="space-y-2">
            <Label>Contenido de la nota</Label>
            <Textarea 
              value={data.text || ""} 
              onChange={e => updateData("text", e.target.value)}
              rows={3}
            />
          </div>
        )}

        {type === "toggle_ai" && (
          <div className="flex items-center gap-2">
            <Switch 
              checked={data.ai_enabled !== false} 
              onCheckedChange={v => updateData("ai_enabled", v)} 
            />
            <Label>IA Activada</Label>
          </div>
        )}

        {type === "goto_flow" && (
          <div className="space-y-2">
            <Label>Flujo destino</Label>
            <Select value={data.flow_id || ""} onValueChange={(v) => updateData("flow_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un flujo" />
              </SelectTrigger>
              <SelectContent>
                {flows.map((flow) => (
                  <SelectItem key={flow.id} value={flow.id}>{flow.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {isConditionalType && (
          <div className="space-y-4 border border-dashed border-border rounded-xl bg-muted/50 p-4">
            <div className="space-y-2">
              <div className="text-sm font-semibold">Acciones por rama</div>
              <p className="text-xs text-muted-foreground">Selecciona la acción para cada rama y configura sus detalles directamente aquí.</p>
            </div>

            {(["yes", "no"] as const).map((branch) => (
              <div key={branch} className="space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Rama {branch === "yes" ? "Sí" : "No"}
                  </div>
                </div>
                <div className="space-y-3">
                  <Label>Agregar acción</Label>
                  <Select
                    value={branchSelection[branch]}
                    onValueChange={(value) => handleAddBranchStep(value, branch)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={`Selecciona una acción para rama ${branch === "yes" ? "Sí" : "No"}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {branchActionOptions.map((option) => (
                        <SelectItem key={`${branch}-${option.id}`} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {(branch === "yes" ? branchYesSteps : branchNoSteps).length > 0 ? (
                  <div className="rounded-xl border bg-background p-3 space-y-3">
                    <div className="text-xs font-semibold">Pasos en esta rama</div>
                    {(branch === "yes" ? branchYesSteps : branchNoSteps).map((child) => (
                      <div key={child.id} className="rounded-md border bg-muted/10 p-3">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div>
                            <div className="text-sm font-medium">{branchActionOptions.find((option) => option.id === child.step_type)?.label || child.step_type}</div>
                            <div className="text-xs text-muted-foreground">Paso #{child.step_order}</div>
                          </div>
                          {onBranchDelete && (
                            <Button size="icon" variant="ghost" onClick={() => onBranchDelete?.(child.id)}>
                              <span className="sr-only">Eliminar paso</span>
                              ✕
                            </Button>
                          )}
                        </div>
                        {renderBranchStepEditor(child)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                    No hay acciones asignadas para esta rama.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {type === "if_replied" && (
          <div className="p-3 bg-blue-50/50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 text-xs rounded-md border border-blue-200 dark:border-blue-800">
            Esta condición evalúa si el contacto ha respondido desde la última vez que el flujo estuvo inactivo (por un paso de "espera").
            Asegúrate de colocar un paso de <strong>Espera</strong> inmediatamente antes de esta condición para darle tiempo al cliente de responder.
          </div>
        )}
      </div>
    </div>
  );
}
