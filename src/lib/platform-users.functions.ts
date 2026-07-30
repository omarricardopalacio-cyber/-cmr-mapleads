/**
 * Control master de usuarios de la plataforma (SUPER_ADMIN).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin, setPlatformRole } from "@/lib/supabase-admin";
import { isSuperAdmin } from "@/lib/super-admin.server";

/** Emails que pueden reclamar rol master automáticamente */
const MASTER_EMAILS = [
  "omarricardopalacio@gmail.com",
  ...(process.env.MASTER_ADMIN_EMAIL
    ? [String(process.env.MASTER_ADMIN_EMAIL).trim().toLowerCase()]
    : []),
].map((e) => e.toLowerCase());

async function assertMaster(userId: string) {
  const ok = await isSuperAdmin(userId);
  if (!ok) throw new Error("Se requiere rol master (SUPER_ADMIN)");
}

async function getAuthEmail(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return null;
    return String(data.user.email).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Convierte al usuario actual en master si su email está autorizado,
 * o confirma si ya es SUPER_ADMIN.
 */
export const claimMasterAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Unauthorized");

    if (await isSuperAdmin(userId)) {
      return { ok: true, isMaster: true, granted: false };
    }

    const email = await getAuthEmail(userId);
    if (!email || !MASTER_EMAILS.includes(email)) {
      throw new Error(
        "Tu cuenta no está autorizada como master. Contacta al administrador de la plataforma.",
      );
    }

    const granted = await setPlatformRole(userId, "SUPER_ADMIN");
    if (!granted) throw new Error("No se pudo asignar rol SUPER_ADMIN");

    // Asegurar perfil activo
    await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, is_active: true, display_name: email.split("@")[0] } as any, {
        onConflict: "id",
      });

    return { ok: true, isMaster: true, granted: true, email };
  });

export const getPlatformUsersStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertMaster(context.userId);

    const { count: total } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });

    const { count: active } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    const { count: inactive } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_active", false);

    const { count: orgs } = await supabaseAdmin
      .from("organizations")
      .select("id", { count: "exact", head: true });

    return {
      totalUsers: total ?? 0,
      activeUsers: active ?? 0,
      inactiveUsers: inactive ?? 0,
      organizations: orgs ?? 0,
    };
  });

export const listPlatformUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().max(200).optional(),
        onlyInactive: z.boolean().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertMaster(context.userId);

    const page = data.page ?? 1;
    const pageSize = data.pageSize ?? 50;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Listar desde Auth Admin (tiene email)
    const { data: listed, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: pageSize,
    });
    if (error) throw new Error(error.message);

    const authUsers = listed?.users ?? [];
    const ids = authUsers.map((u: any) => u.id as string);

    const { data: profiles } = ids.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, display_name, is_active, created_at")
          .in("id", ids)
      : { data: [] as any[] };

    const { data: roles } = ids.length
      ? await supabaseAdmin
          .from("user_roles")
          .select("user_id, org_id, role, organizations:org_id(id, name, status)")
          .in("user_id", ids)
      : { data: [] as any[] };

    const { data: platformRoles } = ids.length
      ? await supabaseAdmin
          .from("platform_roles")
          .select("user_id, role")
          .in("user_id", ids)
      : { data: [] as any[] };

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const platformMap = new Map((platformRoles ?? []).map((p: any) => [p.user_id, p.role]));
    const rolesByUser = new Map<string, any[]>();
    for (const r of roles ?? []) {
      const uid = r.user_id as string;
      if (!rolesByUser.has(uid)) rolesByUser.set(uid, []);
      rolesByUser.get(uid)!.push(r);
    }

    let users = authUsers.map((u: any) => {
      const p = profileMap.get(u.id);
      const memberships = (rolesByUser.get(u.id) || []).map((r: any) => ({
        orgId: r.org_id,
        role: r.role,
        orgName: Array.isArray(r.organizations)
          ? r.organizations[0]?.name
          : r.organizations?.name,
        orgStatus: Array.isArray(r.organizations)
          ? r.organizations[0]?.status
          : r.organizations?.status,
      }));
      return {
        id: u.id as string,
        email: (u.email as string) || null,
        displayName: (p?.display_name as string) || u.email?.split("@")[0] || "Sin nombre",
        isActive: p?.is_active !== false,
        isMaster: platformMap.get(u.id) === "SUPER_ADMIN",
        createdAt: u.created_at || p?.created_at || null,
        lastSignInAt: u.last_sign_in_at || null,
        memberships,
      };
    });

    const search = (data.search || "").trim().toLowerCase();
    if (search) {
      users = users.filter(
        (u) =>
          u.email?.toLowerCase().includes(search) ||
          u.displayName.toLowerCase().includes(search) ||
          u.memberships.some((m) => String(m.orgName || "").toLowerCase().includes(search)),
      );
    }
    if (data.onlyInactive) {
      users = users.filter((u) => !u.isActive);
    }

    // Nota: listUsers de Auth ya pagina; total aproximado
    const total = listed?.total ?? users.length;

    return {
      users,
      page,
      pageSize,
      total,
      from,
      to,
    };
  });

export const setPlatformUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        userId: z.string().uuid(),
        isActive: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertMaster(context.userId);

    if (data.userId === context.userId && !data.isActive) {
      throw new Error("No puedes desactivar tu propia cuenta master");
    }

    // No desactivar a otro master
    if (!data.isActive && (await isSuperAdmin(data.userId))) {
      throw new Error("No puedes desactivar a otro usuario master");
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: data.userId,
          is_active: data.isActive,
        } as any,
        { onConflict: "id" },
      );

    if (error) throw new Error(error.message);

    // Ban/unban en Auth para corte duro de sesión
    try {
      if (!data.isActive) {
        await supabaseAdmin.auth.admin.updateUserById(data.userId, {
          ban_duration: "876000h", // ~100 años
        });
      } else {
        await supabaseAdmin.auth.admin.updateUserById(data.userId, {
          ban_duration: "none",
        });
      }
    } catch (err) {
      console.warn("[setPlatformUserActive] ban toggle:", (err as Error)?.message);
    }

    return { ok: true, userId: data.userId, isActive: data.isActive };
  });
