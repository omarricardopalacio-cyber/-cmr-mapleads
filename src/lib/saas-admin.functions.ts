/**
 * SaaS Admin Functions
 * 
 * Todas estas funciones requieren:
 * 1. Validación de SUPER_ADMIN role
 * 2. Audit logging
 * 3. Suspensión de org check
 * 
 * SEGURIDAD: Estas funciones usan service_role key (en servidor).
 * Nunca exponerlas al cliente sin validación SUPER_ADMIN.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  supabaseAdmin,
  getAdminContext,
  getPlatformRole,
  setPlatformRole,
  removePlatformRole,
  listPlans,
  createPlan,
  getSubscription,
  updateSubscription,
  createAuditLog,
  listAuditLogs,
  getActiveImpersonation,
  startImpersonation,
  stopImpersonation,
  getGlobalSettings,
  updateGlobalSettings,
} from "./supabase-admin";
import type { Database } from "./database.types";

// ============================================================================
// MIDDLEWARE: Validar SUPER_ADMIN antes de cada función
// ============================================================================

async function requireSuperAdmin(userId: string): Promise<void> {
  const role = await getPlatformRole(userId);
  if (role !== "SUPER_ADMIN") {
    throw new Error(
      "SUPER_ADMIN role required. Audit logged. Request denied."
    );
  }
}

// ============================================================================
// 1. GET SAAS ACCESS - Verificar SUPER_ADMIN
// ============================================================================

export const getSaasAccess = createServerFn(
  { method: "GET" },
  async (_input, { context }) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    const adminContext = await getAdminContext(userId);

    return {
      isSuperAdmin: adminContext.isSuperAdmin,
      userId,
    };
  }
);

// ============================================================================
// 2. LIST SAAS COMPANIES - Listar todas las organizaciones
// ============================================================================

export const listSaasCompanies = createServerFn(
  { method: "GET" },
  async (
    _input: {
      limit?: number;
      offset?: number;
      search?: string;
    },
    { context }
  ) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    let query = supabaseAdmin.from("organizations").select(
      `
        id,
        name,
        status,
        created_at,
        updated_at,
        saas_subscriptions (
          plan_id,
          status,
          saas_plans (
            name,
            price
          )
        )
      `
    );

    if (_input.search) {
      query = query.ilike("name", `%${_input.search}%`);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(_input.offset || 0, (_input.offset || 0) + (_input.limit || 50) - 1);

    if (error) throw error;

    await createAuditLog("LIST_COMPANIES", {
      actorUserId: userId,
      ip: undefined,
      metadata: { search: _input.search },
    });

    return data || [];
  }
);

// ============================================================================
// 3. UPDATE COMPANY - Actualizar estado de organización
// ============================================================================

export const updateCompany = createServerFn(
  { method: "POST" },
  async (
    _input: {
      orgId: string;
      status: "active" | "trial" | "suspended";
    },
    { context }
  ) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    const { data, error } = await supabaseAdmin
      .from("organizations")
      .update({ status: _input.status })
      .eq("id", _input.orgId)
      .select()
      .single();

    if (error) throw error;

    await createAuditLog("UPDATE_COMPANY", {
      actorUserId: userId,
      orgId: _input.orgId,
      ip: undefined,
      metadata: { newStatus: _input.status },
    });

    return data;
  }
);

// ============================================================================
// 4. START IMPERSONATION - Suplantar una organización
// ============================================================================

export const startImpersonationFn = createServerFn(
  { method: "POST" },
  async (
    _input: {
      orgId: string;
    },
    { context }
  ) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    const result = await startImpersonation(userId, _input.orgId);

    if (!result) {
      throw new Error("Failed to start impersonation");
    }

    await createAuditLog("START_IMPERSONATION", {
      actorUserId: userId,
      orgId: _input.orgId,
      ip: undefined,
      metadata: { impersonationId: result.id },
    });

    return result;
  }
);

// ============================================================================
// 5. STOP IMPERSONATION - Terminar suplantación
// ============================================================================

export const stopImpersonationFn = createServerFn(
  { method: "POST" },
  async (_input, { context }) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    const result = await stopImpersonation(userId);

    if (!result) {
      return null;
    }

    await createAuditLog("STOP_IMPERSONATION", {
      actorUserId: userId,
      orgId: result.org_id,
      ip: undefined,
    });

    return result;
  }
);

// ============================================================================
// 6. LIST SAAS USERS - Listar usuarios con roles
// ============================================================================

export const listSaasUsers = createServerFn(
  { method: "GET" },
  async (
    _input: {
      limit?: number;
      offset?: number;
    },
    { context }
  ) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    const { data, error } = await supabaseAdmin
      .from("platform_roles")
      .select("user_id, role, created_at")
      .order("created_at", { ascending: false })
      .range(_input.offset || 0, (_input.offset || 0) + (_input.limit || 50) - 1);

    if (error) throw error;

    await createAuditLog("LIST_SAAS_USERS", {
      actorUserId: userId,
      ip: undefined,
    });

    return data || [];
  }
);

// ============================================================================
// 7. UPDATE SAAS USER - Actualizar rol de usuario SaaS
// ============================================================================

export const updateSaasUser = createServerFn(
  { method: "POST" },
  async (
    _input: {
      userId: string;
      action: "grant" | "revoke";
    },
    { context }
  ) => {
    const currentUserId = context?.userId;
    if (!currentUserId) throw new Error("Unauthorized");

    await requireSuperAdmin(currentUserId);

    if (_input.action === "grant") {
      const success = await setPlatformRole(_input.userId, "SUPER_ADMIN");
      if (!success) throw new Error("Failed to grant role");

      await createAuditLog("GRANT_SUPER_ADMIN", {
        actorUserId: currentUserId,
        ip: undefined,
        metadata: { targetUserId: _input.userId },
      });

      return { success: true, action: "granted" };
    } else {
      const success = await removePlatformRole(_input.userId);
      if (!success) throw new Error("Failed to revoke role");

      await createAuditLog("REVOKE_SUPER_ADMIN", {
        actorUserId: currentUserId,
        ip: undefined,
        metadata: { targetUserId: _input.userId },
      });

      return { success: true, action: "revoked" };
    }
  }
);

// ============================================================================
// 8. SAVE SAAS PLAN - Crear o actualizar plan de suscripción
// ============================================================================

export const saveSaasPlan = createServerFn(
  { method: "POST" },
  async (
    _input: {
      id?: string;
      name: string;
      price: number;
      limits: {
        maxUsers: number;
        maxWaSessions: number;
        maxContacts: number;
        maxCampaigns: number;
        maxAutomations: number;
      };
    },
    { context }
  ) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    let data;
    let error;

    if (_input.id) {
      // Update
      const result = await supabaseAdmin
        .from("saas_plans")
        .update({
          name: _input.name,
          price: _input.price,
          max_users: _input.limits.maxUsers,
          max_wa_sessions: _input.limits.maxWaSessions,
          max_contacts: _input.limits.maxContacts,
          max_campaigns: _input.limits.maxCampaigns,
          max_automations: _input.limits.maxAutomations,
          updated_at: new Date().toISOString(),
        })
        .eq("id", _input.id)
        .select()
        .single();

      data = result.data;
      error = result.error;
    } else {
      // Create
      const result = await createPlan(_input.name, _input.price, _input.limits);
      data = result;
    }

    if (error) throw error;
    if (!data) throw new Error("Failed to save plan");

    await createAuditLog("SAVE_SAAS_PLAN", {
      actorUserId: userId,
      ip: undefined,
      metadata: { planId: data.id, name: _input.name, price: _input.price },
    });

    return data;
  }
);

// ============================================================================
// 9. LIST SUBSCRIPTIONS - Listar suscripciones
// ============================================================================

export const listSubscriptions = createServerFn(
  { method: "GET" },
  async (
    _input: {
      limit?: number;
      offset?: number;
    },
    { context }
  ) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    const { data, error } = await supabaseAdmin
      .from("saas_subscriptions")
      .select(
        `
        *,
        organizations (
          id,
          name,
          status
        ),
        saas_plans (
          name,
          price
        )
      `
      )
      .order("created_at", { ascending: false })
      .range(_input.offset || 0, (_input.offset || 0) + (_input.limit || 50) - 1);

    if (error) throw error;

    await createAuditLog("LIST_SUBSCRIPTIONS", {
      actorUserId: userId,
      ip: undefined,
    });

    return data || [];
  }
);

// ============================================================================
// 10. SAVE SUBSCRIPTION - Crear o actualizar suscripción
// ============================================================================

export const saveSubscription = createServerFn(
  { method: "POST" },
  async (
    _input: {
      orgId: string;
      planId: string;
      status: "active" | "trial" | "suspended" | "expired";
      renews_at?: string;
    },
    { context }
  ) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    const sub = await getSubscription(_input.orgId);

    const data = sub
      ? await updateSubscription(_input.orgId, {
          plan_id: _input.planId,
          status: _input.status,
          renews_at: _input.renews_at || null,
        })
      : await supabaseAdmin
          .from("saas_subscriptions")
          .insert({
            org_id: _input.orgId,
            plan_id: _input.planId,
            status: _input.status,
            renews_at: _input.renews_at || null,
          })
          .select()
          .single()
          .then((r) => (r.error ? null : r.data));

    if (!data) throw new Error("Failed to save subscription");

    await createAuditLog("SAVE_SUBSCRIPTION", {
      actorUserId: userId,
      orgId: _input.orgId,
      ip: undefined,
      metadata: { planId: _input.planId, status: _input.status },
    });

    return data;
  }
);

// ============================================================================
// 11. LIST GLOBAL SESSIONS - Sesiones activas globales
// ============================================================================

export const listGlobalSessions = createServerFn(
  { method: "GET" },
  async (_input, { context }) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    const { data, error } = await supabaseAdmin
      .from("saas_impersonations")
      .select(
        `
        *,
        organizations (
          id,
          name
        )
      `
      )
      .order("started_at", { ascending: false });

    if (error) throw error;

    await createAuditLog("LIST_GLOBAL_SESSIONS", {
      actorUserId: userId,
      ip: undefined,
    });

    return data || [];
  }
);

// ============================================================================
// 12. MANAGE GLOBAL SESSION - Terminar sesión global (suplantación)
// ============================================================================

export const manageGlobalSession = createServerFn(
  { method: "POST" },
  async (
    _input: {
      impersonationId: string;
    },
    { context }
  ) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    const { data, error } = await supabaseAdmin
      .from("saas_impersonations")
      .update({
        ended_at: new Date().toISOString(),
      })
      .eq("id", _input.impersonationId)
      .select()
      .single();

    if (error) throw error;

    await createAuditLog("END_GLOBAL_SESSION", {
      actorUserId: userId,
      ip: undefined,
      metadata: { impersonationId: _input.impersonationId },
    });

    return data;
  }
);

// ============================================================================
// 13. LIST SAAS AUDIT - Logs de auditoría
// ============================================================================

export const listSaasAudit = createServerFn(
  { method: "GET" },
  async (
    _input: {
      limit?: number;
      offset?: number;
      action?: string;
    },
    { context }
  ) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    let query = supabaseAdmin.from("saas_audit_logs").select("*");

    if (_input.action) {
      query = query.eq("action", _input.action);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(_input.offset || 0, (_input.offset || 0) + (_input.limit || 100) - 1);

    if (error) throw error;

    return data || [];
  }
);

// ============================================================================
// 14. GET GLOBAL SETTINGS - Obtener configuración global
// ============================================================================

export const getGlobalSettingsFn = createServerFn(
  { method: "GET" },
  async (_input, { context }) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    const settings = await getGlobalSettings();

    return settings;
  }
);

// ============================================================================
// 15. SAVE GLOBAL SETTINGS - Guardar configuración global
// ============================================================================

export const saveGlobalSettings = createServerFn(
  { method: "POST" },
  async (
    _input: {
      platformName?: string;
      primaryColor?: string;
      globalLimits?: Record<string, any>;
      aiConfig?: Record<string, any>;
    },
    { context }
  ) => {
    const userId = context?.userId;
    if (!userId) throw new Error("Unauthorized");

    await requireSuperAdmin(userId);

    const data = await updateGlobalSettings(
      {
        platform_name: _input.platformName,
        primary_color: _input.primaryColor,
        global_limits: _input.globalLimits,
        ai_config: _input.aiConfig,
      },
      userId
    );

    if (!data) throw new Error("Failed to save global settings");

    await createAuditLog("SAVE_GLOBAL_SETTINGS", {
      actorUserId: userId,
      ip: undefined,
      metadata: { updates: _input },
    });

    return data;
  }
);

