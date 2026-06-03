import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { waitMs } from "./flow-blocks";

export async function processDueRuns(limit = 100) {
  const now = new Date().toISOString();
  const { data: runs, error } = await supabaseAdmin
    .from("flow_runs")
    .select(`
      id,
      flow_id,
      current_step_id,
      status,
      contact_id,
      next_execution_at,
      last_interaction_at,
      org_id
    `)
    .in("status", ["active", "running", "wait_node"])
    .lte("next_execution_at", now)
    .limit(limit);

  if (error || !runs) {
    console.error("[flow-runner] Failed to fetch due runs", error);
    return;
  }

  for (const run of runs) {
    try {
      await processRun(run);
    } catch (err: any) {
      console.error(`[flow-runner] Error processing run ${run.id}:`, err);
      await supabaseAdmin
        .from("flow_runs")
        .update({ status: "paused", error: err.message || "Unknown error" })
        .eq("id", run.id);
    }
  }
}

export async function processRun(run: any) {
  if (!run.current_step_id) {
    await supabaseAdmin
      .from("flow_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", run.id);
    return;
  }

  // Marcar como corriendo si no lo estaba (por ejemplo si viene de wait_node o active)
  if (run.status !== "running") {
    await supabaseAdmin.from("flow_runs").update({ status: "running" }).eq("id", run.id);
  }

  const { data: step } = await supabaseAdmin
    .from("flow_steps")
    .select("*")
    .eq("id", run.current_step_id)
    .single();

  if (!step) {
    throw new Error("Paso actual no encontrado");
  }

  const result = await execStep(run, step);

  if (result.wait) {
    // Si el paso retornó una espera, pausamos hasta la fecha
    const nextAt = new Date(Date.now() + result.wait).toISOString();
    await supabaseAdmin
      .from("flow_runs")
      .update({ status: "wait_node", next_execution_at: nextAt })
      .eq("id", run.id);
    return;
  }

  if (result.end) {
    await supabaseAdmin
      .from("flow_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", run.id);
    return;
  }

  // Calcular siguiente paso
  const nextStepId = await calculateNextStep(run.flow_id, step, result.branch);
  
  if (nextStepId) {
    await supabaseAdmin
      .from("flow_runs")
      .update({
        current_step_id: nextStepId,
        next_execution_at: new Date().toISOString()
      })
      .eq("id", run.id);
  } else {
    // No hay más pasos
    await supabaseAdmin
      .from("flow_runs")
      .update({ status: "completed", current_step_id: null, finished_at: new Date().toISOString() })
      .eq("id", run.id);
  }
}

async function execStep(run: any, step: any): Promise<{ branch?: string; wait?: number; end?: boolean }> {
  const sd = step.step_data || {};
  const orgId = run.org_id;
  const contactId = run.contact_id;

  // Helpers
  const getContactWaId = async () => {
    const { data } = await supabaseAdmin.from("contacts").select("wa_id").eq("id", contactId).single();
    return data?.wa_id;
  };
  
  const getThreadId = async () => {
    const { data } = await supabaseAdmin.from("threads").select("id").eq("contact_id", contactId).limit(1).maybeSingle();
    return data?.id;
  };

  switch (step.step_type) {
    // ---- COMUNICACIÓN ----
    case "send_text": {
      const waId = await getContactWaId();
      if (waId && sd.text) {
        await supabaseAdmin.from("engine_commands").insert({
          org_id: orgId,
          type: "send_message",
          payload: { chatId: waId, text: sd.text },
          status: "pending"
        });
      }
      return {};
    }
    case "send_image":
    case "send_video":
    case "send_document": {
      const waId = await getContactWaId();
      if (waId && sd.media_url) {
        await supabaseAdmin.from("engine_commands").insert({
          org_id: orgId,
          type: "send_media",
          payload: { chatId: waId, mediaUrl: sd.media_url, caption: sd.caption, mimeType: sd.mime_type },
          status: "pending"
        });
      }
      return {};
    }
    // ---- TIEMPO ----
    case "wait": {
      const ms = waitMs(sd.amount || 1, sd.unit || "minutes");
      return { wait: ms };
    }
    // ---- IA ----
    case "toggle_ai":
    case "ai_enable":
    case "ai_disable": {
      const threadId = await getThreadId();
      const enabled = step.step_type === "ai_enable" || (step.step_type === "toggle_ai" && sd.ai_enabled);
      if (threadId) {
        await supabaseAdmin.from("threads").update({ ai_enabled: enabled }).eq("id", threadId);
      }
      return {};
    }
    // ---- CRM ----
    case "add_tag":
    case "tag_add": {
      const tagId = sd.tag_id || sd.tagId; // compat
      if (tagId) {
        await (supabaseAdmin as any).from("contact_tags").upsert({ contact_id: contactId, tag_id: tagId, org_id: orgId }, { onConflict: "contact_id,tag_id" });
      }
      return {};
    }
    case "remove_tag":
    case "tag_remove": {
      const tagId = sd.tag_id || sd.tagId;
      if (tagId) {
        await (supabaseAdmin as any).from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", tagId);
      }
      return {};
    }
    // ---- CONDICIONALES ----
    case "condition_reply":
    case "if_replied": {
      // Verificamos si last_interaction_at es más reciente que el momento en que entramos a wait (o si no hay wait, al iniciar el run).
      // Como no tenemos el timestamp exacto del inicio del wait guardado idealmente, usamos la comparación de `last_interaction_at` con `now - wait_amount` o similar.
      // O simplemente, si last_interaction > updated_at del run.
      // Para mayor exactitud, la lógica actual simple:
      const waitStart = run.next_execution_at ?? run.created_at;
      const replied = run.last_interaction_at && new Date(run.last_interaction_at) > new Date(waitStart);
      return { branch: replied ? "yes" : "no" };
    }
    case "if_has_tag": {
      const { data } = await supabaseAdmin.from("contact_tags").select("tag_id").eq("contact_id", contactId).eq("tag_id", sd.tag_id).maybeSingle();
      return { branch: data ? "yes" : "no" };
    }
    // ---- NAVEGACIÓN ----
    case "goto_flow": {
      if (sd.flow_id) {
        // En lugar de llamar trigger, simplemente encolamos el run en el otro flujo
        const { data: firstStep } = await supabaseAdmin.from("flow_steps").select("id").eq("flow_id", sd.flow_id).is("parent_step_id", null).order("step_order", { ascending: true }).limit(1).maybeSingle();
        if (firstStep) {
          await supabaseAdmin.from("flow_runs").insert({
            org_id: orgId, flow_id: sd.flow_id, contact_id: contactId, current_step_id: firstStep.id, status: "active", next_execution_at: new Date().toISOString(), started_at: new Date().toISOString()
          });
        }
      }
      return { end: true }; // Termina este
    }
    case "end_flow": {
      return { end: true };
    }
    default:
      console.warn(`[flow-runner] Step type no implementado: ${step.step_type}`);
      return {};
  }
}

async function calculateNextStep(flowId: string, currentStep: any, branch?: string): Promise<string | null> {
  // 1. Si devolvió branch, buscar un hijo directo con esa rama
  if (branch) {
    const { data: child } = await supabaseAdmin
      .from("flow_steps")
      .select("id")
      .eq("flow_id", flowId)
      .eq("parent_step_id", currentStep.id)
      .eq("branch", branch)
      .order("step_order", { ascending: true })
      .limit(1)
      .maybeSingle();
      
    if (child) return child.id;
  }
  
  // 2. Si no hay hijo por rama o no era un nodo con rama, buscar el siguiente hermano en la secuencia
  const { data: sibling } = await supabaseAdmin
    .from("flow_steps")
    .select("id")
    .eq("flow_id", flowId)
    .gt("step_order", currentStep.step_order)
    .is("parent_step_id", currentStep.parent_step_id === null ? null : currentStep.parent_step_id) // null requires .is(), but we can do a raw match or handle both
    // Unfortunately, if parent_step_id is null, eq won't work in supabase.
    // So we need to handle it properly.
    
  let query = supabaseAdmin
    .from("flow_steps")
    .select("id")
    .eq("flow_id", flowId)
    .gt("step_order", currentStep.step_order)
    .order("step_order", { ascending: true })
    .limit(1);
    
  if (currentStep.parent_step_id === null) {
    query = query.is("parent_step_id", null);
  } else {
    query = query.eq("parent_step_id", currentStep.parent_step_id);
  }
  
  const { data: nextSibling } = await query.maybeSingle();
  if (nextSibling) return nextSibling.id;
  
  // 3. Si terminamos esta rama (hijos agotados), volver al nivel padre y buscar el siguiente paso del padre
  if (currentStep.parent_step_id) {
    const { data: parent } = await supabaseAdmin
      .from("flow_steps")
      .select("id, step_order, parent_step_id")
      .eq("id", currentStep.parent_step_id)
      .single();
    if (parent) {
      return calculateNextStep(flowId, parent, undefined); // Recursión hacia arriba
    }
  }
  
  // 4. Si estamos en el top level y no hay más hermanos
  return null;
}
