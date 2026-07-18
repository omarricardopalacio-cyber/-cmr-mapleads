import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Verifica SUPER_ADMIN vía platform_roles (Fase 1 SaaS).
 * Acepta variantes de nombre por compatibilidad con migraciones parciales.
 */
export async function isSuperAdmin(uid: string | null | undefined): Promise<boolean> {
  if (!uid) return false;

  try {
    const { data, error } = await supabaseAdmin
      .from("platform_roles")
      .select("role")
      .eq("user_id", uid)
      .maybeSingle();

    if (!error && data?.role) {
      const role = String(data.role).toUpperCase();
      if (role === "SUPER_ADMIN" || role === "SUPERADMIN") return true;
    }
  } catch {
    // platform_roles puede no existir aún
  }

  return false;
}

export async function assertSuperAdmin(uid: string): Promise<void> {
  if (!(await isSuperAdmin(uid))) {
    throw new Error("Forbidden: sólo SUPER_ADMIN puede acceder a esta acción de plataforma");
  }
}

/**
 * @deprecated PostgREST/Lovable no expone schema "global". Usar supabaseAdmin + tablas public.* con org_id.
 */
export const globalDb = () => supabaseAdmin;
