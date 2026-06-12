/**
 * Supabase Admin Client - SaaS Module
 * 
 * Proporciona acceso tipado a tablas SaaS con supabaseAdmin.
 * IMPORTANTE: Solo se usa en server functions (service_role key).
 */

import { createClient } from "@supabase/supabase-js";
import type {
  Database,
  SaasPlan,
  SaasSubscription,
  SaasAuditLog,
  SaasImpersonation,
  GlobalSettings,
} from "./database.types";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase configuration in environment variables");
}

export const supabaseAdmin = createClient<Database>(
  supabaseUrl,
  supabaseServiceKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

// ============================================================================
// HELPER FUNCTIONS - Platform Roles
// ============================================================================

export async function getPlatformRole(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("platform_roles")
    .select("role")
    .eq("user_id", userId)
    .single();

  if (error) return null;
  return data?.role || null;
}

export async function setPlatformRole(
  userId: string,
  role: "SUPER_ADMIN"
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("platform_roles").upsert(
    {
      user_id: userId,
      role,
    },
    {
      onConflict: "user_id",
    }
  );

  return !error;
}

export async function removePlatformRole(userId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("platform_roles")
    .delete()
    .eq("user_id", userId);

  return !error;
}

// ============================================================================
// HELPER FUNCTIONS - Plans
// ============================================================================

export async function getPlan(planId: string): Promise<SaasPlan | null> {
  const { data, error } = await supabaseAdmin
    .from("saas_plans")
    .select("*")
    .eq("id", planId)
    .single();

  if (error) return null;
  return data;
}

export async function listPlans(
  includeInactive: boolean = false
): Promise<SaasPlan[]> {
  let query = supabaseAdmin.from("saas_plans").select("*");

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query.order("price", { ascending: true });

  return error ? [] : data || [];
}

export async function createPlan(
  name: string,
  price: number,
  limits: {
    maxUsers: number;
    maxWaSessions: number;
    maxContacts: number;
    maxCampaigns: number;
    maxAutomations: number;
  }
): Promise<SaasPlan | null> {
  const { data, error } = await supabaseAdmin
    .from("saas_plans")
    .insert({
      name,
      price,
      max_users: limits.maxUsers,
      max_wa_sessions: limits.maxWaSessions,
      max_contacts: limits.maxContacts,
      max_campaigns: limits.maxCampaigns,
      max_automations: limits.maxAutomations,
    })
    .select()
    .single();

  if (error) return null;
  return data;
}

// ============================================================================
// HELPER FUNCTIONS - Subscriptions
// ============================================================================

export async function getSubscription(
  orgId: string
): Promise<SaasSubscription | null> {
  const { data, error } = await supabaseAdmin
    .from("saas_subscriptions")
    .select("*")
    .eq("org_id", orgId)
    .single();

  if (error) return null;
  return data;
}

export async function updateSubscription(
  orgId: string,
  updates: Partial<SaasSubscription>
): Promise<SaasSubscription | null> {
  const { data, error } = await supabaseAdmin
    .from("saas_subscriptions")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .select()
    .single();

  if (error) return null;
  return data;
}

// ============================================================================
// HELPER FUNCTIONS - Audit Logs
// ============================================================================

export async function createAuditLog(
  action: string,
  options: {
    actorUserId?: string;
    orgId?: string;
    metadata?: Record<string, any>;
    ip?: string;
  }
): Promise<SaasAuditLog | null> {
  const { data, error } = await supabaseAdmin
    .from("saas_audit_logs")
    .insert({
      action,
      actor_user_id: options.actorUserId,
      org_id: options.orgId,
      metadata: options.metadata || {},
      ip: options.ip,
    })
    .select()
    .single();

  if (error) return null;
  return data;
}

export async function listAuditLogs(
  limit: number = 100,
  offset: number = 0
): Promise<SaasAuditLog[]> {
  const { data, error } = await supabaseAdmin
    .from("saas_audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  return error ? [] : data || [];
}

// ============================================================================
// HELPER FUNCTIONS - Impersonations
// ============================================================================

export async function getActiveImpersonation(
  adminId: string
): Promise<SaasImpersonation | null> {
  const { data, error } = await supabaseAdmin
    .from("saas_impersonations")
    .select("*")
    .eq("super_admin_id", adminId)
    .is("ended_at", null)
    .single();

  if (error?.code === "PGRST116") return null; // Not found
  if (error) return null;
  return data;
}

export async function startImpersonation(
  adminId: string,
  orgId: string
): Promise<SaasImpersonation | null> {
  // End any active impersonation first
  await supabaseAdmin
    .from("saas_impersonations")
    .update({ ended_at: new Date().toISOString() })
    .eq("super_admin_id", adminId)
    .is("ended_at", null);

  const { data, error } = await supabaseAdmin
    .from("saas_impersonations")
    .insert({
      super_admin_id: adminId,
      org_id: orgId,
    })
    .select()
    .single();

  if (error) return null;
  return data;
}

export async function stopImpersonation(
  adminId: string
): Promise<SaasImpersonation | null> {
  const { data, error } = await supabaseAdmin
    .from("saas_impersonations")
    .update({ ended_at: new Date().toISOString() })
    .eq("super_admin_id", adminId)
    .is("ended_at", null)
    .select()
    .single();

  if (error?.code === "PGRST116") return null; // Not found
  if (error) return null;
  return data;
}

// ============================================================================
// HELPER FUNCTIONS - Global Settings
// ============================================================================

export async function getGlobalSettings(): Promise<GlobalSettings | null> {
  const { data, error } = await supabaseAdmin
    .from("global_settings")
    .select("*")
    .eq("id", true)
    .single();

  if (error) return null;
  return data;
}

export async function updateGlobalSettings(
  updates: Partial<GlobalSettings>,
  userId: string
): Promise<GlobalSettings | null> {
  const { data, error } = await supabaseAdmin
    .from("global_settings")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", true)
    .select()
    .single();

  if (error) return null;
  return data;
}

// ============================================================================
// CONTEXT BUILDERS
// ============================================================================

/**
 * Verifica si el usuario es SUPER_ADMIN
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const role = await getPlatformRole(userId);
  return role === "SUPER_ADMIN";
}

/**
 * Contexto de administrador verificado
 */
export interface AdminContext {
  userId: string;
  isSuperAdmin: boolean;
}

export async function getAdminContext(userId: string): Promise<AdminContext> {
  const isSuperAdmin_ = await isSuperAdmin(userId);

  return {
    userId,
    isSuperAdmin: isSuperAdmin_,
  };
}
