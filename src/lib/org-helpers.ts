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

async function fetchOrphanIds(table: "wa_sessions" | "threads" | "contacts", orgId: string): Promise<string[]> {
  const nullRes: any = await (supabaseAdmin as any).from(table).select("id").is("org_id", null);
  const diffRes: any = await (supabaseAdmin as any).from(table).select("id").neq("org_id", orgId);
  const nullIds = ((nullRes.data ?? []) as Array<{ id: string }>).map((r) => r.id);
  const diffIds = ((diffRes.data ?? []) as Array<{ id: string }>).map((r) => r.id);
  return Array.from(new Set([...nullIds, ...diffIds]));
}

async function syncOrphanDataToOrg(userId: string, orgId: string) {
  console.log(`[SYNC] Reasignando datos huérfanos a org ${orgId} para usuario ${userId}`);

  const sessionIds = await fetchOrphanIds("wa_sessions", orgId);
  if (sessionIds.length > 0) {
    const { error } = await supabaseAdmin
      .from("wa_sessions")
      .update({ org_id: orgId })
      .in("id", sessionIds);
    if (error) console.error(`[SYNC ERROR] wa_sessions:`, error.message);
    else console.log(`[SYNC] ${sessionIds.length} wa_sessions reasignadas a org ${orgId}`);
  }

  const threadIds = await fetchOrphanIds("threads", orgId);
  if (threadIds.length > 0) {
    const { error } = await supabaseAdmin
      .from("threads")
      .update({ org_id: orgId })
      .in("id", threadIds);
    if (error) console.error(`[SYNC ERROR] threads:`, error.message);
    else console.log(`[SYNC] ${threadIds.length} threads reasignadas a org ${orgId}`);
  }

  const contactIds = await fetchOrphanIds("contacts", orgId);
  if (contactIds.length > 0) {
    const { error } = await supabaseAdmin
      .from("contacts")
      .update({ org_id: orgId })
      .in("id", contactIds);
    if (error) console.error(`[SYNC ERROR] contacts:`, error.message);
    else console.log(`[SYNC] ${contactIds.length} contacts reasignados a org ${orgId}`);
  }
}

export async function ensureUserOrg(userId: string): Promise<string> {
  let orgId = await getUserOrg(userId);
  if (orgId) return orgId;

  console.log(`[AUTO-HEAL] Usuario ${userId} sin org. Creando org por defecto...`);

  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .insert({ name: "Mi Empresa" })
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

  // Fase 2: Arrastrar datos huérfanos a la nueva org
  await syncOrphanDataToOrg(userId, orgId);

  return orgId;
}
