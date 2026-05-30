import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function getUserOrg(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return data?.org_id ?? null;
}

export async function ensureUserOrg(userId: string): Promise<string> {
  let orgId = await getUserOrg(userId);
  if (orgId) return orgId;

  console.log(`[AUTO-HEAL] Usuario ${userId} sin org. Creando org por defecto...`);

  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .insert({ name: "Mi Empresa", plan: "free" })
    .select("id")
    .single();

  if (orgError || !org) {
    console.error(`[AUTO-HEAL ERROR] No se pudo crear org para ${userId}:`, orgError?.message);
    throw new Error("No se pudo crear organización por defecto");
  }

  orgId = org.id;

  const { error: roleError } = await supabaseAdmin
    .from("user_roles")
    .insert({ user_id: userId, org_id: orgId, role: "owner" });

  if (roleError) {
    console.error(`[AUTO-HEAL ERROR] No se pudo asignar rol para ${userId}:`, roleError.message);
    throw new Error("No se pudo asignar rol de owner");
  }

  console.log(`[AUTO-HEAL] Org ${orgId} + rol owner creados para ${userId}`);
  return orgId;
}
