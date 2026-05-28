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
