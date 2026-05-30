import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function getUserOrg(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return data?.org_id ?? null;
}

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    if (!orgId) return { contacts: 0, threads: 0, messages: 0, sessions: 0 };
    const [c, t, m, s] = await Promise.all([
      supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabaseAdmin.from("threads").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabaseAdmin.from("messages").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabaseAdmin.from("wa_sessions").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    ]);
    return {
      contacts: c.count ?? 0,
      threads: t.count ?? 0,
      messages: m.count ?? 0,
      sessions: s.count ?? 0,
    };
  });

export const listContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    if (!orgId) return { contacts: [] };
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id, wa_id, display_name, phone, updated_at")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(200);
    return { contacts: data ?? [] };
  });

export const listThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    if (!orgId) return { threads: [] };
    const { data } = await supabaseAdmin
      .from("threads")
      .select("id, contact_id, last_message_at, unread_count, contacts(display_name, wa_id, phone)")
      .eq("org_id", orgId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(100);
    return { threads: data ?? [] };
  });
