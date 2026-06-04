// @ts-nocheck
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
        .in("status", ["active", "running", "wait_node"])
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
      await supabaseAdmin
        .from("flow_runs")
        .insert({
          org_id: orgId,
          flow_id: flow.id,
          contact_id: contactId,
          current_step_id: firstStep.id,
          status: "active",
          next_execution_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
        });
    }
  } catch (err: any) {
    console.error(`[flow-trigger] Error triggering flow ${params.triggerType}:`, err.message);
  }
}
