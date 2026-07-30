// @ts-nocheck
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processRunUntilWaitOrCompleted } from "./flow-runner.server";

const ACTIVE_RUN_STATUSES = ["active", "running", "wait_node", "paused"];

/**
 * Cancela ejecuciones activas del contacto.
 * Regla del vigilante: si hay varios flujos, solo debe quedar el último asignado.
 */
export async function cancelActiveFlowRunsForContact(params: {
  orgId: string;
  contactId: string;
  exceptFlowId?: string | null;
  reason?: string;
}): Promise<number> {
  const now = new Date().toISOString();
  let q = supabaseAdmin
    .from("flow_runs")
    .update({
      status: "cancelled",
      finished_at: now,
      updated_at: now,
      error: params.reason || "Reemplazado: solo el último flujo asignado",
    })
    .eq("org_id", params.orgId)
    .eq("contact_id", params.contactId)
    .in("status", ACTIVE_RUN_STATUSES);

  if (params.exceptFlowId) {
    q = q.neq("flow_id", params.exceptFlowId);
  }

  const { data, error } = await q.select("id");
  if (error) {
    console.warn("[cancelActiveFlowRunsForContact]", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Arranca un flujo desde el vigilante (no exige ai_selectable).
 * Cancela cualquier otro flujo activo del contacto y deja solo este.
 */
export async function startWatcherFlowForContact(params: {
  orgId: string;
  contactId: string;
  flowId: string;
}): Promise<{ started: boolean; message: string; run?: any }> {
  const { orgId, contactId, flowId } = params;

  const { data: flow } = await supabaseAdmin
    .from("flows")
    .select("id, name, is_active, max_sends_per_contact")
    .eq("org_id", orgId)
    .eq("id", flowId)
    .maybeSingle();

  if (!flow) return { started: false, message: "El flujo no existe." };
  if (!flow.is_active) {
    return { started: false, message: `El flujo "${flow.name}" no está activo.` };
  }

  const { data: firstStep } = await supabaseAdmin
    .from("flow_steps")
    .select("id")
    .eq("flow_id", flowId)
    .is("parent_step_id", null)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstStep) {
    return { started: false, message: `El flujo "${flow.name}" no tiene pasos.` };
  }

  // Solo el último: cancela los demás (y el mismo si estaba a medias, se reinicia abajo).
  await cancelActiveFlowRunsForContact({
    orgId,
    contactId,
    reason: "Vigilante: nuevo flujo asignado (solo el último)",
  });

  return ensureFlowRunForContact({
    orgId,
    contactId,
    flowId,
    firstStepId: firstStep.id,
    maxSends: flow.max_sends_per_contact,
    flowName: flow.name,
    processNow: true,
  });
}

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
 * Si el flujo tiene product_id, solo arranca con ese producto en foco.
 */
export async function startFlowForContact(params: {
  orgId: string;
  contactId: string;
  flowId: string;
  /** Producto en foco del hilo; requerido si el flujo está ligado a un producto */
  focusedProductId?: string | null;
}): Promise<{ started: boolean; message: string }> {
  const { orgId, contactId, flowId, focusedProductId = null } = params;

  const { data: flow } = await supabaseAdmin
    .from("flows")
    .select(
      "id, name, is_active, ai_selectable, max_sends_per_contact, ai_instructions, product_id",
    )
    .eq("org_id", orgId)
    .eq("id", flowId)
    .maybeSingle();

  if (!flow) return { started: false, message: "Ese paquete no existe." };
  if (!flow.is_active) return { started: false, message: `El paquete "${flow.name}" no está activo.` };
  if (!flow.ai_selectable) {
    return { started: false, message: `El paquete "${flow.name}" no está habilitado para que la IA lo ofrezca.` };
  }

  const flowProductId = (flow as any).product_id ? String((flow as any).product_id) : null;
  if (flowProductId) {
    if (!focusedProductId || focusedProductId !== flowProductId) {
      return {
        started: false,
        message: `El paquete "${flow.name}" solo aplica cuando ese producto está en foco.`,
      };
    }
  } else if (focusedProductId) {
    return {
      started: false,
      message: `Con producto en foco solo puedes activar flujos de ese producto (no paquetes generales).`,
    };
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

  // Al activar un paquete desde la IA, cerrar otros runs (p.ej. saludo en wait_node).
  // Si no, quedan "N ejecutándose", el contexto dice "en curso" y la IA no manda el siguiente.
  await cancelActiveFlowRunsForContact({
    orgId,
    contactId,
    exceptFlowId: flowId,
    reason: "IA activó otro paquete",
  });

  const result = await ensureFlowRunForContact({
    orgId,
    contactId,
    flowId,
    firstStepId: firstStep.id,
    maxSends: flow.max_sends_per_contact,
    flowName: flow.name,
    processNow: true,
  });

  // La promesa del sistema es seguir atendiendo tras el paquete (dudas / opción del menú).
  if (result.started) {
    try {
      const { data: thread } = await supabaseAdmin
        .from("threads")
        .select("id")
        .eq("org_id", orgId)
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (thread?.id) {
        await supabaseAdmin
          .from("threads")
          .update({ ai_enabled: true } as unknown as Record<string, unknown>)
          .eq("id", thread.id)
          .eq("org_id", orgId);
      }
    } catch (err: any) {
      console.warn("[startFlowForContact] no se pudo dejar IA activa:", err?.message || err);
    }
  }

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

/**
 * Arranca el flujo marcado como inicial (is_product_entry) para un producto.
 * Si no hay “flujo inicial”, usa el primer flujo activo ligado a ese product_id.
 * No exige ai_selectable: es automático al enfocar el producto.
 */
export async function startProductEntryFlow(params: {
  orgId: string;
  contactId: string | null | undefined;
  productId: string;
}): Promise<{ started: boolean; message: string; flowId?: string }> {
  const { orgId, productId } = params;
  const contactId = params.contactId ? String(params.contactId) : "";
  if (!contactId || !productId) {
    console.warn("[startProductEntryFlow] falta contactId o productId", {
      orgId,
      productId,
      hasContact: Boolean(contactId),
    });
    return { started: false, message: "Falta contacto o producto." };
  }

  try {
    let flow: any = null;
    const entryRes = await (supabaseAdmin as any)
      .from("flows")
      .select("id, name, is_active, max_sends_per_contact, ai_instructions, product_id, is_product_entry")
      .eq("org_id", orgId)
      .eq("product_id", productId)
      .eq("is_product_entry", true)
      .eq("is_active", true)
      .maybeSingle();

    if (entryRes.error) {
      if (String(entryRes.error.message || "").includes("product_id") || entryRes.error.code === "42703") {
        return { started: false, message: "Migración de flujos por producto pendiente." };
      }
      return { started: false, message: entryRes.error.message };
    }
    flow = entryRes.data;

    // Fallback: primer flujo activo del producto (aunque no esté marcado como inicial)
    if (!flow) {
      const anyRes = await (supabaseAdmin as any)
        .from("flows")
        .select("id, name, is_active, max_sends_per_contact, ai_instructions, product_id, is_product_entry")
        .eq("org_id", orgId)
        .eq("product_id", productId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (anyRes.error) {
        return { started: false, message: anyRes.error.message };
      }
      flow = anyRes.data;
      if (flow) {
        console.info("[startProductEntryFlow] usando flujo activo (no marcado inicial)", {
          orgId,
          productId,
          flowId: flow.id,
          flowName: flow.name,
        });
      }
    }

    if (!flow) {
      console.info("[startProductEntryFlow] sin flujos activos para producto", { orgId, productId });
      return { started: false, message: "Sin flujo activo para este producto." };
    }

    const { data: firstStep } = await supabaseAdmin
      .from("flow_steps")
      .select("id")
      .eq("flow_id", flow.id)
      .is("parent_step_id", null)
      .order("step_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!firstStep) {
      return { started: false, message: `El flujo "${flow.name}" está vacío.` };
    }

    const result = await ensureFlowRunForContact({
      orgId,
      contactId,
      flowId: flow.id,
      firstStepId: firstStep.id,
      maxSends: flow.max_sends_per_contact,
      flowName: flow.name,
      processNow: true,
    });

    console.info("[startProductEntryFlow] resultado", {
      orgId,
      productId,
      flowId: flow.id,
      flowName: flow.name,
      started: result.started,
      message: result.message,
    });

    const instructions = String(flow.ai_instructions || "").trim();
    if (result.started && instructions) {
      return {
        ...result,
        flowId: flow.id,
        message:
          `${result.message}\n\n=== INSTRUCCIONES DEL FLUJO INICIAL ===\n${instructions}`,
      };
    }
    return { ...result, flowId: flow.id };
  } catch (err: any) {
    console.warn("[startProductEntryFlow]", err?.message || err);
    return { started: false, message: err?.message || "Error arrancando flujo inicial" };
  }
}

/** ¿El flujo aplica según el producto en foco del hilo? */
export function flowMatchesProductFocus(
  flowProductId: string | null | undefined,
  focusedProductId: string | null | undefined,
): boolean {
  const fp = flowProductId ? String(flowProductId) : null;
  const focus = focusedProductId ? String(focusedProductId) : null;
  if (fp) return focus === fp;
  return !focus;
}

export async function triggerFlows(params: {
  orgId: string;
  triggerType: string;
  contactId: string;
  triggerValue?: string;
  focusedProductId?: string | null;
}) {
  try {
    const { orgId, triggerType, contactId, triggerValue } = params;
    let focusedProductId = params.focusedProductId ?? null;

    if (focusedProductId === undefined || focusedProductId === null) {
      try {
        const { data: th } = await (supabaseAdmin as any)
          .from("threads")
          .select("focused_product_id")
          .eq("org_id", orgId)
          .eq("contact_id", contactId)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        focusedProductId = th?.focused_product_id ? String(th.focused_product_id) : null;
      } catch {
        focusedProductId = null;
      }
    }

    let query = supabaseAdmin
      .from("flows")
      .select("id, name, max_sends_per_contact, product_id")
      .eq("org_id", orgId)
      .eq("trigger_type", triggerType)
      .eq("is_active", true);

    if (triggerValue) {
      query = query.ilike("trigger_value", triggerValue);
    }

    const { data: flows, error } = await query;
    if (error || !flows || flows.length === 0) return;

    for (const flow of flows) {
      if (!flowMatchesProductFocus((flow as any).product_id, focusedProductId)) continue;

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
