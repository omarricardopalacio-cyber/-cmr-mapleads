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

export const listReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ contactId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: reminders } = await supabaseAdmin
      .from("reminders")
      .select("id, note, reminder_at, is_completed, created_at, user_id")
      .eq("contact_id", data.contactId)
      .eq("org_id", orgId)
      .order("reminder_at", { ascending: true });
    return { reminders: reminders ?? [] };
  });

export const createReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        contactId: z.string().uuid(),
        note: z.string().min(1).max(500),
        reminderAt: z.string().datetime(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: reminder, error } = await supabaseAdmin
      .from("reminders")
      .insert({
        org_id: orgId,
        contact_id: data.contactId,
        user_id: context.userId,
        note: data.note,
        reminder_at: data.reminderAt,
      })
      .select("id, note, reminder_at, is_completed, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { reminder };
  });

export const completeReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ reminderId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("reminders")
      .update({ is_completed: true })
      .eq("id", data.reminderId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const getPendingRemindersCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { count, error } = await supabaseAdmin
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("is_completed", false)
      .lt("reminder_at", new Date().toISOString());
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

export const getPendingReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data, error } = await supabaseAdmin
      .from("reminders")
      .select(
        "id, note, reminder_at, is_completed, created_at, contact_id, contacts(display_name, wa_id)",
      )
      .eq("org_id", orgId)
      .eq("is_completed", false)
      .lt("reminder_at", new Date().toISOString())
      .order("reminder_at", { ascending: true })
      .limit(20);
    if (error) throw new Error(error.message);
    return { reminders: data ?? [] };
  });
