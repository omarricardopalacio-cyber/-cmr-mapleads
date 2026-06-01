import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "@/lib/org-helpers";
import { z } from "zod";

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
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
    const orgId = await ensureUserOrg(context.userId);
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
  .inputValidator((d) =>
    z.object({ filter: z.enum(["all", "mine", "unassigned"]).optional() }).parse(d)
  )
  .handler(async ({ context, data }) => {
    try {
      const orgId = await ensureUserOrg(context.userId);
      console.log(`[DEBUG listThreads] orgId=${orgId} userId=${context.userId} filter=${data.filter ?? "all"}`);

      let query = supabaseAdmin
        .from("threads")
        .select("id, contact_id, last_message_at, unread_count, assigned_to_user_id, contacts:contact_id(id, display_name, wa_id, phone)")
        .eq("org_id", orgId);

      const filter = data.filter ?? "all";
      if (filter === "mine") {
        query = query.eq("assigned_to_user_id", context.userId);
      } else if (filter === "unassigned") {
        query = query.is("assigned_to_user_id", null);
      }

      const { data: threads, error } = await query
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);

      if (error) {
        console.error(`[DATABASE ERROR] en listThreads:`, error.message);
        throw new Error(error.message);
      }

      console.log(`[DEBUG listThreads] éxito: ${(threads ?? []).length} chats para org ${orgId}`);
      // Normalizar contacts a array consistente (Supabase puede devolver objeto u array)
      const normalized = (threads ?? []).map((t: any) => {
        const raw = t.contacts;
        const contact = Array.isArray(raw) ? raw[0] : raw;
        return { ...t, contacts: contact ? [contact] : [] };
      });
      return { threads: normalized as unknown as Array<Record<string, unknown>> };
    } catch (e) {
      console.error(`[SERVER ERROR] en listThreads:`, (e as Error).message);
      throw e;
    }
  });

export const getPipelineStages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data } = await supabaseAdmin
      .from("pipeline_stages")
      .select("id, name, color, position")
      .eq("org_id", orgId)
      .order("position", { ascending: true });
    return { stages: (data ?? []) as Array<{ id: string; name: string; color: string; position: number }> };
  });

export const updateContactStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ contactId: z.string().uuid(), stageId: z.string().uuid().nullable() }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("contacts")
      .update({ pipeline_stage_id: data.stageId })
      .eq("id", data.contactId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const listOrgMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .eq("org_id", orgId);
    const userIds = (roles ?? []).map((r) => r.user_id);
    let profilesById = new Map<string, { display_name: string | null }>();
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);
      profilesById = new Map((profs ?? []).map((p) => [p.id, { display_name: p.display_name }]));
    }
    const members = (roles ?? []).map((r) => ({
      id: r.user_id,
      role: r.role as string,
      displayName: profilesById.get(r.user_id)?.display_name || "Usuario",
    }));
    return { members };
  });

export const getContactCrmData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ contactId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: contact, error } = await supabaseAdmin
      .from("contacts")
      .select("origin, entry_date, exit_date, deal_value, company, position, interested_products, observations")
      .eq("id", data.contactId)
      .eq("org_id", orgId)
      .single();
    if (error) throw new Error(error.message);
    return { contact };
  });

export const updateContactCrmData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      contactId: z.string().uuid(),
      origin: z.string().nullable().optional(),
      entry_date: z.string().nullable().optional(),
      exit_date: z.string().nullable().optional(),
      deal_value: z.number().nullable().optional(),
      company: z.string().nullable().optional(),
      position: z.string().nullable().optional(),
      interested_products: z.string().nullable().optional(),
      observations: z.string().nullable().optional(),
    }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { contactId, ...updates } = data;
    const { error } = await supabaseAdmin
      .from("contacts")
      .update(updates)
      .eq("id", contactId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
