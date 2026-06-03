// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const dyn = () => supabaseAdmin as unknown as { from: (t: string) => any };

async function getUserOrg(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("No organization");
  return data.org_id;
}

// ───── AUTO REPLIES ─────
export const listAutoReplies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await supabaseAdmin
      .from("auto_replies")
      .select("*, auto_reply_steps(*)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    // Sort steps by step_order on the client side
    const rules = (data ?? []).map((r: any) => ({
      ...r,
      steps: (r.auto_reply_steps ?? []).sort((a: any, b: any) => a.step_order - b.step_order),
    }));
    return { rules };
  });

export const upsertAutoReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(100),
        match_type: z.enum(["contains", "equals", "starts", "regex"]),
        match_value: z.string().min(1).max(500),
        is_active: z.boolean().default(true),
        trigger_type: z.enum(["keyword", "first_message_overall", "first_message_month"]).default("keyword"),
        session_id: z.string().uuid().nullable().optional(),
        action_add_tags: z.array(z.string().uuid()).nullable().optional(),
        action_remove_tags: z.array(z.string().uuid()).nullable().optional(),
        action_ai_behavior: z.enum(["no_change", "disable_ai", "enable_ai"]).default("no_change"),
        chain_to_rule_id: z.string().uuid().nullable().optional(),
        limit_per_contact: z.number().int().min(0).nullable().optional(),
        steps: z
          .array(
            z.object({
              cooldown_seconds: z.number().int().min(0).max(2592000).default(0),
              text_content: z.string().max(4000).nullable().optional(),
              media_url: z.string().nullable().optional(),
              mime_type: z.string().max(100).nullable().optional(),
            })
          )
          .min(1),
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { steps, ...ruleData } = data;

    // Upsert the rule itself
    const ruleRow = {
      ...ruleData,
      org_id: orgId,
      created_by: context.userId,
    };
    const { data: result, error } = await supabaseAdmin
      .from("auto_replies")
      .upsert(ruleRow)
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Delete existing steps and reinsert in order
    await supabaseAdmin
      .from("auto_reply_steps")
      .delete()
      .eq("rule_id", result.id);

    const stepRows = steps.map((s, i) => ({
      rule_id: result.id,
      org_id: orgId,
      step_order: i,
      cooldown_seconds: s.cooldown_seconds ?? 0,
      text_content: s.text_content ?? null,
      media_url: s.media_url ?? null,
      mime_type: s.mime_type ?? null,
    }));

    const { error: stepsErr } = await supabaseAdmin
      .from("auto_reply_steps")
      .insert(stepRows);
    if (stepsErr) throw new Error(stepsErr.message);

    return { rule: result };
  });

export const deleteAutoReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await supabaseAdmin.from("auto_replies").delete().eq("id", data.id).eq("org_id", orgId);
    return { ok: true };
  });

// ───── QUICK REPLIES ─────
export const listQuickReplies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await dyn().from("quick_replies")
      .select("*")
      .eq("org_id", orgId)
      .order("shortcut", { ascending: true });
    return { items: (data ?? []) as any[] };
  });

export const upsertQuickReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        shortcut: z.string().min(1).max(50),
        text_content: z.string().min(1).max(4000),
        media_url: z.string().url().nullable().optional(),
        mime_type: z.string().max(100).nullable().optional(),
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const row = { ...data, org_id: orgId };
    const { data: result, error } = await dyn().from("quick_replies")
      .upsert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { item: result as any };
  });

export const deleteQuickReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await dyn().from("quick_replies").delete().eq("id", data.id).eq("org_id", orgId);
    return { ok: true };
  });

// ───── SCHEDULED MESSAGES ─────
export const listScheduled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await supabaseAdmin
      .from("scheduled_messages")
      .select("*")
      .eq("org_id", orgId)
      .order("send_at", { ascending: true })
      .limit(200);
    return { items: data ?? [] };
  });

export const createScheduled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        session_id: z.string().uuid(),
        wa_id: z.string().min(1).max(64),
        text: z.string().min(1).max(4000),
        send_at: z.string().datetime(),
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("scheduled_messages")
      .insert({ ...data, org_id: orgId, created_by: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { item: row };
  });

export const cancelScheduled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await supabaseAdmin
      .from("scheduled_messages")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .eq("org_id", orgId)
      .eq("status", "pending");
    return { ok: true };
  });

// ───── BROADCASTS ─────
export const listBroadcasts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await supabaseAdmin
      .from("broadcasts")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100);
    return { items: data ?? [] };
  });

export const createBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        session_id: z.string().uuid(),
        name: z.string().min(1).max(100),
        message_text: z.string().max(4000).default(""),
        rate_per_minute: z.number().int().min(1).max(60).default(15),
        tag_id: z.string().uuid().nullable().optional(),
        audience: z.enum(["mapleads"]).nullable().optional(),
        wa_ids: z.array(z.string().min(1).max(64)).min(1).max(5000).nullable().optional(),
        media_url: z.string().url().nullable().optional(),
        mime_type: z.string().max(100).nullable().optional(),
        scheduled_at: z.string().datetime().nullable().optional(),
      })
      .refine((d) => d.message_text.length > 0 || !!d.media_url, {
        message: "Debes escribir un mensaje o adjuntar una imagen/archivo",
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    let wa_ids: string[] = data.wa_ids ?? [];
    const mapleadIds: string[] = [];

    if (data.audience === "mapleads") {
      const { data: leads } = await supabaseAdmin
        .from("leads")
        .select("id, phone, phone_normalized")
        .eq("user_id", context.userId)
        .is("message_sent_at", null)
        .neq("phone", "")
        .limit(5000);

      const seen = new Set<string>();
      wa_ids = [];
      for (const l of leads ?? []) {
        const digits = String(l.phone_normalized || l.phone || "").replace(/\D/g, "");
        if (digits && !seen.has(digits)) {
          seen.add(digits);
          wa_ids.push(digits);
          mapleadIds.push(l.id);
        }
      }
      if (!wa_ids.length) throw new Error("No hay leads Mapleads no enviados con teléfono");
    } else if (data.tag_id) {
      const { data: contacts } = await supabaseAdmin
        .from("contact_tags")
        .select("contacts(wa_id)")
        .eq("tag_id", data.tag_id)
        .eq("org_id", orgId);
      const found = (contacts ?? [])
        .map((r: any) => r.contacts?.wa_id)
        .filter(Boolean) as string[];
      wa_ids = [...new Set(found)];
      if (!wa_ids.length) throw new Error("La etiqueta no tiene contactos con wa_id");
    }

    const status = data.scheduled_at ? "scheduled" : "running";
    const { data: b, error } = await supabaseAdmin
      .from("broadcasts")
      .insert({
        org_id: orgId,
        session_id: data.session_id,
        name: data.name,
        message_text: data.message_text,
        rate_per_minute: data.rate_per_minute,
        total_count: wa_ids.length,
        status,
        tag_id: data.tag_id ?? null,
        media_url: data.media_url ?? null,
        mime_type: data.mime_type ?? null,
        scheduled_at: data.scheduled_at ?? null,
        started_at: status === "running" ? new Date().toISOString() : null,
        created_by: context.userId,
      })
      .select()
      .single();
    if (error || !b) throw new Error(error?.message ?? "create broadcast failed");

    const rows = wa_ids.map((wa_id) => ({
      broadcast_id: b.id,
      org_id: orgId,
      wa_id,
    }));
    const { error: rErr } = await supabaseAdmin.from("broadcast_recipients").insert(rows);
    if (rErr) throw new Error(rErr.message);

    // Bloquear leads Mapleads: solo se les puede enviar un mensaje
    if (mapleadIds.length) {
      await supabaseAdmin
        .from("leads")
        .update({
          message_sent_at: new Date().toISOString(),
          message_broadcast_id: b.id,
        })
        .in("id", mapleadIds)
        .eq("user_id", context.userId);
    }

    return { broadcast: b };
  });

export const getBroadcastRecipients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ broadcastId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: rows } = await supabaseAdmin
      .from("broadcast_recipients")
      .select("id, wa_id, status, error, sent_at")
      .eq("broadcast_id", data.broadcastId)
      .eq("org_id", orgId)
      .order("created_at", { ascending: true })
      .limit(500);
    return { items: rows ?? [] };
  });

export const cancelBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await supabaseAdmin
      .from("broadcasts")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("org_id", orgId);
    return { ok: true };
  });

export const pauseBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await supabaseAdmin
      .from("broadcasts")
      .update({ status: "paused" })
      .eq("id", data.id)
      .eq("org_id", orgId)
      .in("status", ["running", "scheduled"]);
    return { ok: true };
  });

export const resumeBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await supabaseAdmin
      .from("broadcasts")
      .update({ status: "running" })
      .eq("id", data.id)
      .eq("org_id", orgId)
      .eq("status", "paused");
    return { ok: true };
  });

export const deleteBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await supabaseAdmin.from("broadcasts").delete().eq("id", data.id).eq("org_id", orgId);
    return { ok: true };
  });

// ───── FLOWS ─────
export const listFlows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await dyn()
      .from("flows")
      .select("*, flow_steps(*), flow_runs(count)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    return { items: data ?? [] };
  });

export const upsertFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(100),
        trigger_type: z.enum(["keyword", "tag_added", "new_contact", "manual"]),
        trigger_value: z.string().nullable().optional(),
        is_active: z.boolean().default(false),
        description: z.string().nullable().optional(),
        ai_mode: z.enum(["none", "on_completion", "during_flow", "on_response", "fallback", "time_limited"]).default("none"),
        ai_time_limit_minutes: z.number().int().positive().nullable().optional(),
        ai_enabled_after_flow: z.boolean().default(false),
        ai_enabled_during_flow: z.boolean().default(false),
        ai_fallback_enabled: z.boolean().default(false),
        ai_transfer_on_failure: z.boolean().default(false),
        ai_maintain_context: z.boolean().default(true),
        ai_can_access_crm: z.boolean().default(true),
        ai_can_access_tags: z.boolean().default(true),
        ai_knowledge_sources: z.array(z.any()).default([]),
        ai_transfer_rules: z.array(z.any()).default([]),
        ai_custom_system_prompt: z.string().nullable().optional(),
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const payload = {
      org_id: orgId,
      name: data.name,
      trigger_type: data.trigger_type,
      trigger_value: data.trigger_value ?? null,
      is_active: data.is_active,
      description: data.description ?? null,
      ai_mode: data.ai_mode,
      ai_time_limit_minutes: data.ai_time_limit_minutes ?? null,
      ai_enabled_after_flow: data.ai_enabled_after_flow,
      ai_enabled_during_flow: data.ai_enabled_during_flow,
      ai_fallback_enabled: data.ai_fallback_enabled,
      ai_transfer_on_failure: data.ai_transfer_on_failure,
      ai_maintain_context: data.ai_maintain_context,
      ai_can_access_crm: data.ai_can_access_crm,
      ai_can_access_tags: data.ai_can_access_tags,
      ai_knowledge_sources: data.ai_knowledge_sources,
      ai_transfer_rules: data.ai_transfer_rules,
      ai_custom_system_prompt: data.ai_custom_system_prompt ?? null,
    };
    if (data.id) {
      const { data: row, error } = await dyn()
        .from("flows")
        .update(payload)
        .eq("id", data.id)
        .eq("org_id", orgId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { flow: row };
    }
    const { data: row, error } = await dyn()
      .from("flows")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { flow: row };
  });

export const deleteFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await (supabaseAdmin as unknown as { from: (t: string) => any }).from("flows").delete().eq("id", data.id).eq("org_id", orgId);
    return { ok: true };
  });

export const setFlowActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await (supabaseAdmin as unknown as { from: (t: string) => any }).from("flows").update({ is_active: data.is_active }).eq("id", data.id).eq("org_id", orgId);
    return { ok: true };
  });

export const listFlowSteps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ flowId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: rows } = await dyn()
      .from("flow_steps")
      .select("*")
      .eq("flow_id", data.flowId)
      .order("step_order", { ascending: true });
    return { items: rows ?? [] };
  });

export const upsertFlowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        flow_id: z.string().uuid(),
        step_order: z.number().int(),
        step_type: z.enum(["send_message", "send_media", "wait", "add_tag", "remove_tag", "toggle_ai", "condition_reply"]),
        step_data: z.record(z.any()),
        parent_step_id: z.string().uuid().nullable().optional(),
        branch: z.enum(["yes", "no"]).nullable().optional(),
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: flow } = await dyn()
      .from("flows")
      .select("id")
      .eq("id", data.flow_id)
      .eq("org_id", orgId)
      .single();
    if (!flow) throw new Error("Flow not found");
    const payload = {
      flow_id: data.flow_id,
      step_order: data.step_order,
      step_type: data.step_type,
      step_data: data.step_data,
      parent_step_id: data.parent_step_id ?? null,
      branch: data.branch ?? null,
    };
    if (data.id) {
      const { data: row, error } = await dyn()
        .from("flow_steps")
        .update(payload)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { step: row };
    }
    const { data: row, error } = await dyn()
      .from("flow_steps")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { step: row };
  });

export const deleteFlowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await supabaseAdmin.rpc("delete_flow_step_safe", { p_step_id: data.id, p_org_id: orgId });
    return { ok: true };
  });

// ───── KNOWLEDGE SOURCES ─────
export const listKnowledgeSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await dyn()
      .from("knowledge_sources")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    return { items: data ?? [] };
  });

export const upsertKnowledgeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(200),
        source_type: z.enum(["faq", "products", "services", "catalog", "pdf_document", "website", "internal_kb", "custom_prompt"]),
        content: z.string().min(1),
        metadata: z.record(z.any()).default({}),
        is_active: z.boolean().default(true),
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const payload = {
      org_id: orgId,
      name: data.name,
      source_type: data.source_type,
      content: data.content,
      metadata: data.metadata,
      is_active: data.is_active,
    };
    if (data.id) {
      const { data: row, error } = await dyn()
        .from("knowledge_sources")
        .update(payload)
        .eq("id", data.id)
        .eq("org_id", orgId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { item: row };
    }
    const { data: row, error } = await dyn()
      .from("knowledge_sources")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { item: row };
  });

export const deleteKnowledgeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await dyn().from("knowledge_sources").delete().eq("id", data.id).eq("org_id", orgId);
    return { ok: true };
  });

// ───── TRANSFER RULES ─────
export const listTransferRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await dyn()
      .from("transfer_rules")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    return { items: data ?? [] };
  });

export const upsertTransferRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(200),
        condition_type: z.enum(["request_human", "ai_no_response", "purchase_intent", "complaint", "support_request", "custom"]),
        condition_config: z.record(z.any()).default({}),
        is_active: z.boolean().default(true),
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const payload = {
      org_id: orgId,
      name: data.name,
      condition_type: data.condition_type,
      condition_config: data.condition_config,
      is_active: data.is_active,
    };
    if (data.id) {
      const { data: row, error } = await dyn()
        .from("transfer_rules")
        .update(payload)
        .eq("id", data.id)
        .eq("org_id", orgId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { item: row };
    }
    const { data: row, error } = await dyn()
      .from("transfer_rules")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { item: row };
  });

export const deleteTransferRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await dyn().from("transfer_rules").delete().eq("id", data.id).eq("org_id", orgId);
    return { ok: true };
  });
