import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cloneTemplateAiConfigToOrg, getTemplateOrgId } from "@/lib/org-helpers";

/**
 * Garantiza que el usuario actual tenga una organización (rol owner).
 * Si no existe, crea "<email>'s Workspace" + user_role owner.
 */
export const ensureOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;

    const { data: existing } = await supabaseAdmin
      .from("user_roles")
      .select("org_id, role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("id, name")
        .eq("id", existing.org_id)
        .single();
      return { orgId: existing.org_id, role: existing.role, name: org?.name ?? "" };
    }

    const templateOrgId = await getTemplateOrgId();
    if (templateOrgId) {
      const { data: org, error: orgErr } = await supabaseAdmin
        .from("organizations")
        .select("id, name")
        .eq("id", templateOrgId)
        .single();
      if (orgErr || !org) throw new Error(orgErr?.message ?? "Failed to load template org");

      const { error: roleErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, org_id: templateOrgId, role: "admin" })
        .onConflict("user_id,org_id,role")
        .ignore();
      if (roleErr) throw new Error(roleErr.message);

      return { orgId: templateOrgId, role: "admin" as const, name: org.name };
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    const name = `${profile?.display_name ?? "My"} Workspace`;

    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .insert({ name, created_by: userId })
      .select("id, name")
      .single();
    if (orgErr || !org) throw new Error(orgErr?.message ?? "Failed to create org");

    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, org_id: org.id, role: "owner" });
    if (roleErr) throw new Error(roleErr.message);

    await cloneTemplateAiConfigToOrg(org.id).catch((error) => {
      console.error(`[AI CONFIG CLONE ERROR] No se pudo clonar la config AI para org ${org.id}:`, (error as Error).message);
    });

    return { orgId: org.id, role: "owner" as const, name: org.name };
  });

export const getOrgStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("org_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const orgId = role?.org_id ?? null;

    if (!orgId) {
      return {
        orgId: null,
        sessionsCount: 0,
        threadsCount: 0,
        contactsCount: 0,
        orphanSessionsCount: 0,
        orphanThreadsCount: 0,
        orphanContactsCount: 0,
      };
    }

    const [
      sessionsRes,
      threadsRes,
      contactsRes,
      orphanSessNull,
      orphanSessDiff,
      orphanThrNull,
      orphanThrDiff,
      orphanContNull,
      orphanContDiff,
    ] = await Promise.all([
      supabaseAdmin.from("wa_sessions").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabaseAdmin.from("threads").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabaseAdmin.from("wa_sessions").select("id", { count: "exact", head: true }).is("org_id", null),
      supabaseAdmin.from("wa_sessions").select("id", { count: "exact", head: true }).neq("org_id", orgId),
      supabaseAdmin.from("threads").select("id", { count: "exact", head: true }).is("org_id", null),
      supabaseAdmin.from("threads").select("id", { count: "exact", head: true }).neq("org_id", orgId),
      supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).is("org_id", null),
      supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).neq("org_id", orgId),
    ]);

    return {
      orgId,
      sessionsCount: sessionsRes.count ?? 0,
      threadsCount: threadsRes.count ?? 0,
      contactsCount: contactsRes.count ?? 0,
      orphanSessionsCount: (orphanSessNull.count ?? 0) + (orphanSessDiff.count ?? 0),
      orphanThreadsCount: (orphanThrNull.count ?? 0) + (orphanThrDiff.count ?? 0),
      orphanContactsCount: (orphanContNull.count ?? 0) + (orphanContDiff.count ?? 0),
    };
  });

async function fetchOrphanIds(table: "wa_sessions" | "threads" | "contacts", orgId: string): Promise<string[]> {
  const nullRes: any = await (supabaseAdmin as any).from(table).select("id").is("org_id", null);
  const diffRes: any = await (supabaseAdmin as any).from(table).select("id").neq("org_id", orgId);
  const nullIds = ((nullRes.data ?? []) as Array<{ id: string }>).map((r) => r.id);
  const diffIds = ((diffRes.data ?? []) as Array<{ id: string }>).map((r) => r.id);
  return Array.from(new Set([...nullIds, ...diffIds]));
}

async function syncTableToOrg(table: "wa_sessions" | "threads" | "contacts", orgId: string): Promise<number> {
  const ids = await fetchOrphanIds(table, orgId);
  if (ids.length === 0) return 0;
  const { error } = await (supabaseAdmin as any).from(table).update({ org_id: orgId }).in("id", ids);
  if (error) throw new Error(`${table}: ${error.message}`);
  return ids.length;
}

export const syncWaSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("org_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const orgId = role?.org_id ?? null;
    if (!orgId) throw new Error("No organization found");
    return { synced: await syncTableToOrg("wa_sessions", orgId) };
  });

export const syncThreads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("org_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const orgId = role?.org_id ?? null;
    if (!orgId) throw new Error("No organization found");
    return { synced: await syncTableToOrg("threads", orgId) };
  });

export const syncContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("org_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const orgId = role?.org_id ?? null;
    if (!orgId) throw new Error("No organization found");
    return { synced: await syncTableToOrg("contacts", orgId) };
  });
