// @ts-nocheck
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processRunUntilWaitOrCompleted } from "./flow-runner.server";

const ACTIVE_RUN_STATUSES = ["active", "running", "wait_node", "paused"];

/**
 * NULL / <= 0 = ilimitado. Si hay tope, bloquea cuando send_count ya lo alcanzó.
 */
export function canSendFlowToContact(params: {
  maxSends: number | null | undefined;
  sendCount: number;
  flowName?: string;
}): { allowed: boolean; reason?: string } {
  const max = params.maxSends;
  if (max == null || max <= 0) return { allowed: true };
  if ((params.sendCount ?? 0) >= max) {
    const label = params.flowName ? `"${params.flowName}"` : "este flujo";
    return {
      allowed: false,
      reason: `Ya se alcanzó el máximo de ${max} envío(s) de ${label} a este cliente.`,
    };
  }
  return { allowed: true };
}

/**
 * Inicia o reinicia un run de flujo para un contacto, respetando el límite
 * max_sends_per_contact. No duplica si ya hay una ejecución en curso.
 */
export async function ensureFlowRunForContact(params: {
  orgId: string;
  contactId: string;
  flowId: string;
  firstStepId: string;
  maxSends?: number | null;
  flowName?: string;
  processNow?: boolean;
}): Promise<{ started: boolean; message: string; run?: any }> {
  const {
    orgId,
    contactId,
    flowId,
    firstStepId,
    maxSends = null,
    flowName,
    processNow = true,
  } = params;

  const { data: existingRun } = await supabaseAdmin
    .from("flow_runs")
    .select("id, status, send_count")
    .eq("org_id", orgId)
    .eq("flow_id", flowId)
    .eq("contact_id", contactId)
    .maybeSingle();

  if (existingRun && ACTIVE_RUN_STATUSES.includes(existingRun.status)) {
    return {
      started: false,
      message: flowName
        ? `El paquete "${flowName}" ya se le está enviando al cliente.`
        : "Este contacto ya tiene una ejecución activa para este flujo.",
    };
  }

  const currentCount = existingRun?.send_count ?? 0;
  const check = canSendFlowToContact({
    maxSends,
    sendCount: currentCount,
    flowName,
  });
  if (!check.allowed) {
    return { started: false, message: check.reason || "Límite de envíos alcanzado." };
  }

  const nowStr = new Date().toISOString();
  let run;

  if (existingRun) {
    const { data, error } = await supabaseAdmin
      .from("flow_runs")
      .update({
        current_step_id: firstStepId,
        status: "active",
        next_execution_at: nowStr,
        updated_at: nowStr,
        started_at: nowStr,
        finished_at: null,
        error: null,
        send_count: currentCount + 1,
        last_interaction_at: nowStr,
      })
      .eq("id", existingRun.id)
      .select()
      .single();
    if (error) return { started: false, message: `No se pudo iniciar el flujo: ${error.message}` };
    run = data;
  } else {
    const { data, error } = await supabaseAdmin
      .from("flow_runs")
      .insert({
        org_id: orgId,
        flow_id: flowId,
        contact_id: contactId,
        current_step_id: firstStepId,
        status: "active",
        next_execution_at: nowStr,
        send_count: 1,
        last_interaction_at: nowStr,
      })
      .select()
      .single();
    if (error) return { started: false, message: `No se pudo iniciar el flujo: ${error.message}` };
    run = data;
  }

  if (run && processNow) {
    try {
      await processRunUntilWaitOrCompleted(run);
    } catch (err: any) {
      console.error("[ensureFlowRunForContact] Error procesando run", err?.message, { flowId, contactId });
    }
  }

  return {
    started: true,
    message: flowName
      ? `El paquete "${flowName}" se está enviando al cliente en orden. NO reenvíes ni describas ese contenido; el sistema ya lo envía. Quédate atento para responder dudas después.`
      : "Flujo iniciado.",
    run,
  };
}

/**
 * Inicia (o reinicia) un flujo para un contacto y lo ejecuta al instante,
 * enviando sus pasos en orden. Pensado para que la IA active "paquetes".
 * No duplica si ya hay una ejecución en curso. Respeta max_sends_per_contact.
 */
export async function startFlowForContact(params: {
  orgId: string;
  contactId: string;
  flowId: string;
}): Promise<{ started: boolean; message: string }> {
  const { orgId, contactId, flowId } = params;

  const { data: flow } = await supabaseAdmin
    .from("flows")
    .select("id, name, is_active, ai_selectable, max_sends_per_contact, ai_instructions")
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

  const result = await ensureFlowRunForContact({
    orgId,
    contactId,
    flowId,
    firstStepId: firstStep.id,
    maxSends: flow.max_sends_per_contact,
    flowName: flow.name,
    processNow: true,
  });

  // Si el paquete arrancó, anexar instrucciones para que la IA sepa cómo atender después.
  const instructions = String(flow.ai_instructions || "").trim();
  if (result.started && instructions) {
    return {
      ...result,
      message:
        `${result.message}\n\n=== INSTRUCCIONES PARA ATENDER ESTE PAQUETE ===\n` +
        `El sistema YA está enviando el contenido del paquete al cliente. Tú NO lo reenvíes ni lo copies. ` +
        `Usa estas instrucciones para responder dudas, pedir datos y cerrar la venta:\n${instructions}`,
    };
  }

  return result;
}

export async function triggerFlows(params: {
  orgId: string;
  triggerType: string;
  contactId: string;
  triggerValue?: string;
}) {
  try {
    const { orgId, triggerType, contactId, triggerValue } = params;

    let query = supabaseAdmin
      .from("flows")
      .select("id, name, max_sends_per_contact")
      .eq("org_id", orgId)
      .eq("trigger_type", triggerType)
      .eq("is_active", true);

    if (triggerValue) {
      query = query.ilike("trigger_value", triggerValue);
    }

    const { data: flows, error } = await query;
    if (error || !flows || flows.length === 0) return;

    for (const flow of flows) {
      const { data: firstStep } = await supabaseAdmin
        .from("flow_steps")
        .select("id")
        .eq("flow_id", flow.id)
        .is("parent_step_id", null)
        .order("step_order", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!firstStep) continue;

      await ensureFlowRunForContact({
        orgId,
        contactId,
        flowId: flow.id,
        firstStepId: firstStep.id,
        maxSends: flow.max_sends_per_contact,
        flowName: flow.name,
        processNow: true,
      });
    }
  } catch (err: any) {
    console.error(`[flow-trigger] Error triggering flow ${params.triggerType}:`, err.message);
  }
}
