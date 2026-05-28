import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    return { rules: data ?? [] };
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
        reply_text: z.string().min(1).max(4000),
        is_active: z.boolean().default(true),
        cooldown_seconds: z.number().int().min(0).max(86400).default(60),
        session_id: z.string().uuid().nullable().optional(),
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const row = { ...data, org_id: orgId, created_by: context.userId };
    const { data: result, error } = await supabaseAdmin
      .from("auto_replies")
      .upsert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
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
        message_text: z.string().min(1).max(4000),
        rate_per_minute: z.number().int().min(1).max(60).default(15),
        wa_ids: z.array(z.string().min(1).max(64)).min(1).max(5000),
        scheduled_at: z.string().datetime().nullable().optional(),
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const status = data.scheduled_at ? "scheduled" : "running";
    const { data: b, error } = await supabaseAdmin
      .from("broadcasts")
      .insert({
        org_id: orgId,
        session_id: data.session_id,
        name: data.name,
        message_text: data.message_text,
        rate_per_minute: data.rate_per_minute,
        total_count: data.wa_ids.length,
        status,
        scheduled_at: data.scheduled_at ?? null,
        started_at: status === "running" ? new Date().toISOString() : null,
        created_by: context.userId,
      })
      .select()
      .single();
    if (error || !b) throw new Error(error?.message ?? "create broadcast failed");

    const rows = data.wa_ids.map((wa_id) => ({
      broadcast_id: b.id,
      org_id: orgId,
      wa_id,
    }));
    const { error: rErr } = await supabaseAdmin.from("broadcast_recipients").insert(rows);
    if (rErr) throw new Error(rErr.message);
    return { broadcast: b };
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
