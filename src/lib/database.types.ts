/**
 * Database Types - Extended Schema
 * 
 * Este archivo complementa los tipos autogenerados por Supabase CLI.
 * Se usa para agregar tipos de las nuevas tablas del módulo SaaS.
 * 
 * NO EDITAR MANUALMENTE - Se regenera con:
 * supabase gen types typescript --project-id yllscifugirkpogvdfzi > src/integrations/supabase/types.ts
 * 
 * Después de eso, este adaptador proporciona tipos completos tipados.
 */

import type { Database as GeneratedDatabase } from "@/integrations/supabase/types";

// Tipos adicionales para SaaS
export type PlatformRole = "SUPER_ADMIN";
export type OrganizationStatus = "active" | "trial" | "suspended";
export type SubscriptionStatus = "active" | "trial" | "suspended" | "expired";

// Extensión del schema para SaaS
export interface SaaSTables {
  platform_roles: {
    Row: {
      id: string;
      user_id: string;
      role: PlatformRole;
      created_at: string;
    };
    Insert: {
      id?: string;
      user_id: string;
      role: PlatformRole;
      created_at?: string;
    };
    Update: {
      id?: string;
      user_id?: string;
      role?: PlatformRole;
      created_at?: string;
    };
  };
  saas_plans: {
    Row: {
      id: string;
      name: string;
      price: number;
      max_users: number;
      max_wa_sessions: number;
      max_contacts: number;
      max_campaigns: number;
      max_automations: number;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      name: string;
      price?: number;
      max_users?: number;
      max_wa_sessions?: number;
      max_contacts?: number;
      max_campaigns?: number;
      max_automations?: number;
      is_active?: boolean;
      created_at?: string;
      updated_at?: string;
    };
    Update: {
      id?: string;
      name?: string;
      price?: number;
      max_users?: number;
      max_wa_sessions?: number;
      max_contacts?: number;
      max_campaigns?: number;
      max_automations?: number;
      is_active?: boolean;
      created_at?: string;
      updated_at?: string;
    };
  };
  saas_subscriptions: {
    Row: {
      id: string;
      org_id: string;
      plan_id: string;
      status: SubscriptionStatus;
      starts_at: string;
      renews_at: string | null;
      amount: number;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      org_id: string;
      plan_id: string;
      status?: SubscriptionStatus;
      starts_at?: string;
      renews_at?: string | null;
      amount?: number;
      created_at?: string;
      updated_at?: string;
    };
    Update: {
      id?: string;
      org_id?: string;
      plan_id?: string;
      status?: SubscriptionStatus;
      starts_at?: string;
      renews_at?: string | null;
      amount?: number;
      created_at?: string;
      updated_at?: string;
    };
  };
  saas_audit_logs: {
    Row: {
      id: string;
      actor_user_id: string | null;
      org_id: string | null;
      action: string;
      metadata: Record<string, any>;
      ip: string | null;
      created_at: string;
    };
    Insert: {
      id?: string;
      actor_user_id?: string | null;
      org_id?: string | null;
      action: string;
      metadata?: Record<string, any>;
      ip?: string | null;
      created_at?: string;
    };
    Update: {
      id?: string;
      actor_user_id?: string | null;
      org_id?: string | null;
      action?: string;
      metadata?: Record<string, any>;
      ip?: string | null;
      created_at?: string;
    };
  };
  saas_impersonations: {
    Row: {
      id: string;
      super_admin_id: string;
      org_id: string;
      started_at: string;
      ended_at: string | null;
    };
    Insert: {
      id?: string;
      super_admin_id: string;
      org_id: string;
      started_at?: string;
      ended_at?: string | null;
    };
    Update: {
      id?: string;
      super_admin_id?: string;
      org_id?: string;
      started_at?: string;
      ended_at?: string | null;
    };
  };
  global_settings: {
    Row: {
      id: boolean;
      platform_name: string;
      logo_url: string | null;
      primary_color: string;
      global_limits: Record<string, any>;
      ai_config: Record<string, any>;
      whatsapp_config: Record<string, any>;
      updated_at: string;
      updated_by: string | null;
    };
    Insert: {
      id?: boolean;
      platform_name?: string;
      logo_url?: string | null;
      primary_color?: string;
      global_limits?: Record<string, any>;
      ai_config?: Record<string, any>;
      whatsapp_config?: Record<string, any>;
      updated_at?: string;
      updated_by?: string | null;
    };
    Update: {
      id?: boolean;
      platform_name?: string;
      logo_url?: string | null;
      primary_color?: string;
      global_limits?: Record<string, any>;
      ai_config?: Record<string, any>;
      whatsapp_config?: Record<string, any>;
      updated_at?: string;
      updated_by?: string | null;
    };
  };
}

/**
 * Complete Database type including SaaS tables
 */
export type Database = GeneratedDatabase & {
  public: GeneratedDatabase["public"] & {
    Tables: GeneratedDatabase["public"]["Tables"] & SaaSTables;
  };
};

// Export para comodidad
export type SaasPlan = SaaSTables["saas_plans"]["Row"];
export type SaasSubscription = SaaSTables["saas_subscriptions"]["Row"];
export type SaasAuditLog = SaaSTables["saas_audit_logs"]["Row"];
export type SaasImpersonation = SaaSTables["saas_impersonations"]["Row"];
export type GlobalSettings = SaaSTables["global_settings"]["Row"];
