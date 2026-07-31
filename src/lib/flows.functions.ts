// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "@/lib/org-helpers";
import { TRIGGERS } from "@/lib/flow-blocks";

const FLOW_TRIGGER_TYPES = TRIGGERS.map((trigger) => trigger.id);

// CRUD Flows
export const listFlows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
    let flows: any[] | null = null;
    {
      const res = await supabaseAdmin
        .from("flows")
        .select("*, products:product_id(id, name)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      if (res.error && (String(res.error.message || "").includes("product_id") || res.error.code === "42703")) {
        const legacy = await supabaseAdmin
          .from("flows")
          .select("*")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false });
        flows = legacy.data;
      } else {
        flows = res.data;
      }
    }
      
    // Enriquecer con conteo de runs activos si es necesario
    const flowsWithCounts = await Promise.all(
      (flows ?? []).map(async (f) => {
        const { count } = await supabaseAdmin
          .from("flow_runs")
          .select("id", { count: "exact", head: true })
          .eq("flow_id", f.id)
          .in("status", ["active", "running", "wait_node"]);
        const prod = Array.isArray(f.products) ? f.products[0] : f.products;
        return {
          ...f,
          active_runs: count ?? 0,
          product_name: prod?.name || null,
        };
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
    // Sin default: si el editor no envía is_active, NO se toca el estado actual
    // del flujo (antes un default:false lo apagaba al guardar/editar).
    is_active: z.boolean().optional(),
    ai_selectable: z.boolean().optional(),
    // null / omitido = ilimitado; entero >= 1 = tope de envíos por cliente
    max_sends_per_contact: z.number().int().min(1).nullable().optional(),
    ai_instructions: z.string().nullable().optional(),
    product_id: z.string().uuid().nullable().optional(),
    is_product_entry: z.boolean().optional(),
  }).passthrough().parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { id, ...payload } = data;

    // Un solo flujo inicial activo por producto
    if (payload.product_id && payload.is_product_entry) {
      let clearQ = supabaseAdmin
        .from("flows")
        .update({ is_product_entry: false })
        .eq("org_id", orgId)
        .eq("product_id", payload.product_id)
        .eq("is_product_entry", true);
      if (id) clearQ = clearQ.neq("id", id);
      await clearQ;
    }
    if (!payload.product_id) {
      payload.is_product_entry = false;
    }
    
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

    const { data: flow } = await supabaseAdmin
      .from("flows")
      .select("id, name, max_sends_per_contact")
      .eq("id", data.flowId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!flow) throw new Error("Flujo no encontrado");

    const { data: firstStep } = await supabaseAdmin
      .from("flow_steps")
      .select("id")
      .eq("flow_id", data.flowId)
      .is("parent_step_id", null)
      .order("step_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!firstStep) throw new Error("Flujo vacío");

    const { ensureFlowRunForContact } = await import("./flow-trigger.server");
    const result = await ensureFlowRunForContact({
      orgId,
      contactId: data.contactId,
      flowId: data.flowId,
      firstStepId: firstStep.id,
      maxSends: flow.max_sends_per_contact,
      flowName: flow.name,
      processNow: true,
    });

    if (!result.started) throw new Error(result.message);
    return { run: result.run };
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

/**
 * Busca o crea el flujo inicial (is_product_entry) ligado a un producto.
 * Usado desde Observaciones para editar pasos con todas las opciones de Flujos Automatizados.
 */
export const ensureProductEntryFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        productId: z.string().uuid(),
        productName: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);

    const { data: product } = await (supabaseAdmin as any)
      .from("products")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("id", data.productId)
      .maybeSingle();
    if (!product) throw new Error("Producto no encontrado");

    const nameHint =
      String(data.productName || product.name || "Producto").trim().slice(0, 120) || "Producto";

    let { data: flow, error } = await supabaseAdmin
      .from("flows")
      .select("id, name, is_active, is_product_entry, product_id, description")
      .eq("org_id", orgId)
      .eq("product_id", data.productId)
      .eq("is_product_entry", true)
      .maybeSingle();

    if (error && (String(error.message || "").includes("product_id") || error.code === "42703")) {
      throw new Error(
        "Falta migración de flujos por producto (product_id / is_product_entry).",
      );
    }
    if (error) throw new Error(error.message);

    if (!flow) {
      const { data: linked } = await supabaseAdmin
        .from("flows")
        .select("id, name, is_active, is_product_entry, product_id, description")
        .eq("org_id", orgId)
        .eq("product_id", data.productId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (linked) {
        const { data: promoted, error: pe } = await supabaseAdmin
          .from("flows")
          .update({
            is_product_entry: true,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", linked.id)
          .eq("org_id", orgId)
          .select("id, name, is_active, is_product_entry, product_id, description")
          .single();
        if (pe) throw new Error(pe.message);
        flow = promoted;
      }
    }

    if (!flow) {
      const { data: created, error: ce } = await supabaseAdmin
        .from("flows")
        .insert({
          org_id: orgId,
          name: `Entrada: ${nameHint}`,
          description:
            "Flujo especializado al entrar a este producto (mensajes, etiquetas, media, esperas, IA…). Se arranca junto con la ficha.",
          trigger_type: "manual",
          trigger_value: null,
          is_active: true,
          ai_selectable: false,
          product_id: data.productId,
          is_product_entry: true,
        } as any)
        .select("id, name, is_active, is_product_entry, product_id, description")
        .single();
      if (ce) throw new Error(ce.message);
      flow = created;
    }

    const { count } = await supabaseAdmin
      .from("flow_steps")
      .select("id", { count: "exact", head: true })
      .eq("flow_id", flow!.id);

    return {
      flow: {
        ...flow,
        steps_count: count ?? 0,
      },
    };
  });

/** Info del flujo de entrada de un producto (sin crear). */
export const getProductEntryFlow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: flow, error } = await supabaseAdmin
      .from("flows")
      .select("id, name, is_active, is_product_entry, product_id")
      .eq("org_id", orgId)
      .eq("product_id", data.productId)
      .eq("is_product_entry", true)
      .maybeSingle();

    if (error && (String(error.message || "").includes("product_id") || error.code === "42703")) {
      return { flow: null };
    }
    if (error) throw new Error(error.message);
    if (!flow) return { flow: null };

    const { count } = await supabaseAdmin
      .from("flow_steps")
      .select("id", { count: "exact", head: true })
      .eq("flow_id", flow.id);

    return { flow: { ...flow, steps_count: count ?? 0 } };
  });
