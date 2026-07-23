// @ts-nocheck
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processRunUntilWaitOrCompleted } from "./flow-runner.server";

/**
 * Inicia (o reinicia) un flujo para un contacto y lo ejecuta al instante,
 * enviando sus pasos en orden. Pensado para que la IA active "paquetes".
 * No duplica si ya hay una ejecución en curso.
 */
export async function startFlowForContact(params: {
  orgId: string;
  contactId: string;
  flowId: string;
}): Promise<{ started: boolean; message: string }> {
  const { orgId, contactId, flowId } = params;

  // El flujo debe existir, estar activo y ser ofertable por la IA.
  const { data: flow } = await supabaseAdmin
    .from("flows")
    .select("id, name, is_active, ai_selectable")
    .eq("org_id", orgId)
    .eq("id", flowId)
    .maybeSingle();

  if (!flow) return { started: false, message: "Ese paquete no existe." };
  if (!flow.is_active) return { started: false, message: `El paquete "${flow.name}" no está activo.` };
  if (!flow.ai_selectable) {
    return { started: false, message: `El paquete "${flow.name}" no está habilitado para que la IA lo ofrezca.` };
  }

  const { data: firstStep } = await supabaseAdmin
    .from("flow_steps")
    .select("id")
    .eq("flow_id", flowId)
    .is("parent_step_id", null)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstStep) return { started: false, message: `El paquete "${flow.name}" está vacío.` };

  const { data: existingRun } = await supabaseAdmin
    .from("flow_runs")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("flow_id", flowId)
    .eq("contact_id", contactId)
    .maybeSingle();

  // Si ya se está enviando, no lo duplicamos.
  if (existingRun && ["active", "running", "wait_node", "paused"].includes(existingRun.status)) {
    return { started: false, message: `El paquete "${flow.name}" ya se le está enviando al cliente.` };
  }

  const nowStr = new Date().toISOString();
  let run;
  if (existingRun) {
    const { data, error } = await supabaseAdmin
      .from("flow_runs")
      .update({
        current_step_id: firstStep.id,
        status: "active",
        next_execution_at: nowStr,
        updated_at: nowStr,
        started_at: nowStr,
        finished_at: null,
        error: null,
      })
      .eq("id", existingRun.id)
      .select()
      .single();
    if (error) return { started: false, message: `No se pudo iniciar el paquete: ${error.message}` };
    run = data;
  } else {
    const { data, error } = await supabaseAdmin
      .from("flow_runs")
      .insert({
        org_id: orgId,
        flow_id: flowId,
        contact_id: contactId,
        current_step_id: firstStep.id,
        status: "active",
        next_execution_at: nowStr,
      })
      .select()
      .single();
    if (error) return { started: false, message: `No se pudo iniciar el paquete: ${error.message}` };
    run = data;
  }

  if (run) {
    try {
      await processRunUntilWaitOrCompleted(run);
    } catch (err: any) {
      console.error("[startFlowForContact] Error procesando run", err?.message, { flowId, contactId });
    }
  }

  return {
    started: true,
    message: `El paquete "${flow.name}" se está enviando al cliente en orden. NO reenvíes ni describas ese contenido; el sistema ya lo envía. Quédate atento para responder dudas después.`,
  };
}

export async function triggerFlows(params: {
  orgId: string;
  triggerType: string;
  contactId: string;
  triggerValue?: string;
}) {
  try {
    const { orgId, triggerType, contactId, triggerValue } = params;

    // Buscar flujos activos con este disparador
    let query = supabaseAdmin
      .from("flows")
      .select("id")
      .eq("org_id", orgId)
      .eq("trigger_type", triggerType)
      .eq("is_active", true);

    if (triggerValue) {
      // Comparación sensible a minúsculas por si acaso
      query = query.ilike("trigger_value", triggerValue);
    }

    const { data: flows, error } = await query;
    if (error || !flows || flows.length === 0) return;

    for (const flow of flows) {
      // Prevenir múltiples ejecuciones del mismo flujo para el mismo contacto si el flujo ya está corriendo o programado
      const { data: existingRun } = await supabaseAdmin
        .from("flow_runs")
        .select("id")
        .eq("org_id", orgId)
        .eq("flow_id", flow.id)
        .eq("contact_id", contactId)
        .in("status", ["active", "running", "wait_node", "paused"])
        .maybeSingle();

      if (existingRun) continue; // Ya está en el flujo

      // Obtener el primer paso del flujo
      const { data: firstStep } = await supabaseAdmin
        .from("flow_steps")
        .select("id")
        .eq("flow_id", flow.id)
        .is("parent_step_id", null)
        .order("step_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!firstStep) continue;

      // Encolar el flujo
      const { data: run, error: insertError } = await supabaseAdmin
        .from("flow_runs")
        .insert({
          org_id: orgId,
          flow_id: flow.id,
          contact_id: contactId,
          current_step_id: firstStep.id,
          status: "active",
          next_execution_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        console.error("[flow-trigger] Failed to insert flow_run", insertError.message, { flowId: flow.id, contactId });
        continue;
      }

      if (run) {
        try {
          await processRunUntilWaitOrCompleted(run);
        } catch (err: any) {
          console.error("[flow-trigger] Error processing newly triggered run", err.message, { runId: run.id });
        }
      }
    }
  } catch (err: any) {
    console.error(`[flow-trigger] Error triggering flow ${params.triggerType}:`, err.message);
  }
}
