import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
      return { orgId: null, sessionsCount: 0, threadsCount: 0, orphanSessionsCount: 0 };
    }

    const [sessionsRes, threadsRes, orphanNullRes, orphanDiffRes] = await Promise.all([
      supabaseAdmin.from("wa_sessions").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabaseAdmin.from("threads").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabaseAdmin.from("wa_sessions").select("id", { count: "exact", head: true }).is("org_id", null),
      supabaseAdmin.from("wa_sessions").select("id", { count: "exact", head: true }).neq("org_id", orgId),
    ]);

    return {
      orgId,
      sessionsCount: sessionsRes.count ?? 0,
      threadsCount: threadsRes.count ?? 0,
      orphanSessionsCount: (orphanNullRes.count ?? 0) + (orphanDiffRes.count ?? 0),
    };
  });

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

    const nullRes = await supabaseAdmin.from("wa_sessions").select("id").is("org_id", null);
    const diffRes = await supabaseAdmin.from("wa_sessions").select("id").neq("org_id", orgId);
    const ids = Array.from(new Set([
      ...(nullRes.data ?? []).map((r: { id: string }) => r.id),
      ...(diffRes.data ?? []).map((r: { id: string }) => r.id),
    ]));

    if (ids.length === 0) return { synced: 0 };

    const { error } = await supabaseAdmin
      .from("wa_sessions")
      .update({ org_id: orgId })
      .in("id", ids);
    if (error) throw new Error(error.message);
    return { synced: ids.length };
  });
