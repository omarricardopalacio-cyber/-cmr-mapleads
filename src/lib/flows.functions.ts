// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "@/lib/org-helpers";
import { TRIGGERS } from "@/lib/flow-blocks";
import { processRunUntilWaitOrCompleted } from "@/lib/flow-runner.server";

const FLOW_TRIGGER_TYPES = TRIGGERS.map((trigger) => trigger.id);

// CRUD Flows
export const listFlows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: flows } = await supabaseAdmin
      .from("flows")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
      
    // Enriquecer con conteo de runs activos si es necesario
    const flowsWithCounts = await Promise.all(
      (flows ?? []).map(async (f) => {
        const { count } = await supabaseAdmin
          .from("flow_runs")
          .select("id", { count: "exact", head: true })
          .eq("flow_id", f.id)
          .in("status", ["active", "running", "wait_node"]);
        return { ...f, active_runs: count ?? 0 };
      })
    );
      
    return { flows: flowsWithCounts };
  });

export const getFlow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: flow, error } = await supabaseAdmin
      .from("flows")
      .select("*")
      .eq("id", data.id)
      .eq("org_id", orgId)
      .single();
    if (error) throw new Error(error.message);
    return { flow };
  });

export const upsertFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1),
    trigger_type: z.string().refine((value) => FLOW_TRIGGER_TYPES.includes(value), {
      message: `trigger_type must be one of: ${FLOW_TRIGGER_TYPES.join(", ")}`,
    }),
    trigger_value: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    is_active: z.boolean().optional().default(false),
    ai_selectable: z.boolean().optional(),
  }).passthrough().parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { id, ...payload } = data;
    
    if (id) {
      const { data: flow, error } = await supabaseAdmin
        .from("flows")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("org_id", orgId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { flow };
    } else {
      const { data: flow, error } = await supabaseAdmin
        .from("flows")
        .insert({ ...payload, org_id: orgId })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { flow };
    }
  });

export const deleteFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("flows")
      .delete()
      .eq("id", data.id)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const duplicateFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    
    // 1. Obtener flujo original
    const { data: original, error } = await supabaseAdmin
      .from("flows")
      .select("*")
      .eq("id", data.id)
      .eq("org_id", orgId)
      .single();
      
    if (error || !original) throw new Error("Flujo no encontrado");
    
    // 2. Crear copia del flujo
    const { id: _, created_at, updated_at, ...copyData } = original;
    const { data: copy, error: copyErr } = await supabaseAdmin
      .from("flows")
      .insert({
        ...copyData,
        name: `${original.name} (Copia)`,
        is_active: false
      })
      .select()
      .single();
      
    if (copyErr) throw new Error(copyErr.message);
    
    // 3. Copiar los pasos
    const { data: steps } = await supabaseAdmin
      .from("flow_steps")
      .select("*")
      .eq("flow_id", original.id);
      
    if (steps && steps.length > 0) {
      // Necesitamos un mapa de IDs viejos a nuevos para preservar parent_step_id
      const idMap = new Map<string, string>();
      
      // Primera pasada: insertar los pasos con IDs nuevos
      for (const step of steps) {
        const { id: oldId, flow_id, created_at, updated_at, ...stepData } = step;
        const { data: newStep } = await supabaseAdmin
          .from("flow_steps")
          .insert({
            ...stepData,
            flow_id: copy.id,
            parent_step_id: null // Se actualiza luego
          })
          .select()
          .single();
        if (newStep) idMap.set(oldId, newStep.id);
      }
      
      // Segunda pasada: actualizar parent_step_id
      for (const step of steps) {
        if (step.parent_step_id && idMap.has(step.parent_step_id)) {
          await supabaseAdmin
            .from("flow_steps")
            .update({ parent_step_id: idMap.get(step.parent_step_id) })
            .eq("id", idMap.get(step.id));
        }
      }
    }
    
    return { flow: copy };
  });

export const setFlowActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("flows")
      .update({ is_active: data.is_active })
      .eq("id", data.id)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// CRUD Steps
export const listFlowSteps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ flowId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    // Podríamos validar que el flujo pertenece a la ORG, pero RLS ayuda si lo pasamos,
    // o podemos omitirlo por simplicidad al ser lectura.
    const { data: steps } = await supabaseAdmin
      .from("flow_steps")
      .select("*")
      .eq("flow_id", data.flowId)
      .order("step_order", { ascending: true });
    return { steps: steps ?? [] };
  });

export const upsertSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    flowId: z.string().uuid(),
    steps: z.array(z.any())
  }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    
    // Validar propiedad del flujo
    const { data: flow } = await supabaseAdmin
      .from("flows")
      .select("id")
      .eq("id", data.flowId)
      .eq("org_id", orgId)
      .single();
    if (!flow) throw new Error("Acceso denegado al flujo");

    // Reemplazo total: borrar existentes e insertar nuevos
    await supabaseAdmin
      .from("flow_steps")
      .delete()
      .eq("flow_id", data.flowId);
      
    if (data.steps.length > 0) {
      const pendingSteps = [...data.steps];
      const idMap = new Map<string, string>();
      let progress = true;

      while (pendingSteps.length > 0 && progress) {
        progress = false;

        for (let i = pendingSteps.length - 1; i >= 0; i -= 1) {
          const step = pendingSteps[i];
          const hasTempParent = step.parent_step_id && String(step.parent_step_id).startsWith("temp-");

          if (hasTempParent && !idMap.has(step.parent_step_id as string)) {
            continue;
          }

          const row: any = {
            flow_id: data.flowId,
            step_type: step.step_type,
            step_order: step.step_order,
            step_data: step.step_data ?? {},
            parent_step_id: null,
            branch: step.branch || null,
          };

          if (step.id && !String(step.id).startsWith("temp-")) {
            row.id = step.id;
          }

          if (step.parent_step_id) {
            if (String(step.parent_step_id).startsWith("temp-")) {
              row.parent_step_id = idMap.get(step.parent_step_id as string) || null;
            } else {
              row.parent_step_id = step.parent_step_id;
            }
          }

          if (row.id == null) {
            delete row.id;
          }

          const { data: insertedRow, error } = await supabaseAdmin
            .from("flow_steps")
            .insert(row)
            .select()
            .single();

          if (error) throw new Error(error.message);

          if (step.id && String(step.id).startsWith("temp-")) {
            idMap.set(step.id, insertedRow.id);
          }

          pendingSteps.splice(i, 1);
          progress = true;
        }
      }

      if (pendingSteps.length > 0) {
        throw new Error("No se pudieron guardar todos los pasos del flujo debido a referencias inválidas de padre.");
      }
    }
    
    return { success: true };
  });

// RUNS
export const listFlowRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ flowId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: runs, error } = await supabaseAdmin
      .from("flow_runs")
      .select(`
        *,
        contacts:contact_id(display_name, phone, wa_id),
        flow_steps:current_step_id(step_type)
      `)
      .eq("flow_id", data.flowId)
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(100);
      
    if (error) throw new Error(error.message);
    return { runs: runs ?? [] };
  });

export const updateRunStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    runId: z.string().uuid(),
    status: z.enum(["paused", "active", "cancelled"])
  }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("flow_runs")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.runId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const runFlowManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    flowId: z.string().uuid(),
    contactId: z.string().uuid()
  }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    
    const { data: firstStep } = await supabaseAdmin
      .from("flow_steps")
      .select("id")
      .eq("flow_id", data.flowId)
      .is("parent_step_id", null)
      .order("step_order", { ascending: true })
      .limit(1)
      .maybeSingle();
      
    if (!firstStep) throw new Error("Flujo vacío");

    const { data: existingRun } = await supabaseAdmin
      .from("flow_runs")
      .select("id, status")
      .eq("org_id", orgId)
      .eq("flow_id", data.flowId)
      .eq("contact_id", data.contactId)
      .maybeSingle();

    if (existingRun && ["active", "running", "wait_node", "paused"].includes(existingRun.status)) {
      throw new Error("Este contacto ya tiene una ejecución activa o pausada para este flujo.");
    }

    if (existingRun) {
      const { data: run, error } = await supabaseAdmin
        .from("flow_runs")
        .update({
          current_step_id: firstStep.id,
          status: "active",
          next_execution_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
        })
        .eq("id", existingRun.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      if (run) {
        await processRunUntilWaitOrCompleted(run);
      }
      return { run };
    }

    const { data: run, error } = await supabaseAdmin
      .from("flow_runs")
      .insert({
        org_id: orgId,
        flow_id: data.flowId,
        contact_id: data.contactId,
        current_step_id: firstStep.id,
        status: "active",
        next_execution_at: new Date().toISOString(),
      })
      .select()
      .single();
      
    if (error) throw new Error(error.message);
    if (run) {
      await processRunUntilWaitOrCompleted(run);
    }
    return { run };
  });

export const listContactsLite = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id, display_name, phone, wa_id")
      .eq("org_id", orgId)
      .order("display_name", { ascending: true })
      .limit(500);
    return { contacts: data ?? [] };
  });

// TEMPLATES
export const listFlowTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data: templates } = await supabaseAdmin
      .from("flow_templates")
      .select("*")
      .order("created_at", { ascending: false });
    return { templates: templates ?? [] };
  });

export const createFromTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ templateId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    
    const { data: template } = await supabaseAdmin
      .from("flow_templates")
      .select("*")
      .eq("id", data.templateId)
      .single();
      
    if (!template) throw new Error("Plantilla no encontrada");
    
    // Crear el flujo
    const { data: flow, error: flowErr } = await supabaseAdmin
      .from("flows")
      .insert({
        org_id: orgId,
        name: template.name,
        trigger_type: template.trigger_type,
        is_active: false
      })
      .select()
      .single();
      
    if (flowErr) throw new Error(flowErr.message);
    
    // Insertar pasos desde template.steps
    const steps = Array.isArray(template.steps) ? template.steps : [];
    if (steps.length > 0) {
      const inserts = steps.map((s: any, i: number) => ({
        flow_id: flow.id,
        step_type: s.step_type,
        step_order: s.step_order || (i + 1),
        step_data: s.step_data || {},
        parent_step_id: null, // Si la plantilla requiere lógica compleja, se debería mapear IDs temporales
        branch: s.branch || null
      }));
      
      await supabaseAdmin.from("flow_steps").insert(inserts);
    }
    
    return { flow };
  });
