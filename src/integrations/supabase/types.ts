export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          created_at: string
          updated_at: string
          status: 'active' | 'trial' | 'suspended'
          [key: string]: any
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
          updated_at?: string
          status?: 'active' | 'trial' | 'suspended'
          [key: string]: any
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
          updated_at?: string
          status?: 'active' | 'trial' | 'suspended'
          [key: string]: any
        }
      }
      platform_roles: {
        Row: {
          id: string
          user_id: string
          role: 'SUPER_ADMIN'
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          role: 'SUPER_ADMIN'
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          role?: 'SUPER_ADMIN'
          created_at?: string
        }
      }
      saas_plans: {
        Row: {
          id: string
          name: string
          price: number
          max_users: number
          max_wa_sessions: number
          max_contacts: number
          max_campaigns: number
          max_automations: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          price?: number
          max_users?: number
          max_wa_sessions?: number
          max_contacts?: number
          max_campaigns?: number
          max_automations?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          price?: number
          max_users?: number
          max_wa_sessions?: number
          max_contacts?: number
          max_campaigns?: number
          max_automations?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      saas_subscriptions: {
        Row: {
          id: string
          org_id: string
          plan_id: string
          status: 'active' | 'trial' | 'suspended' | 'expired'
          starts_at: string
          renews_at: string | null
          amount: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          plan_id: string
          status?: 'active' | 'trial' | 'suspended' | 'expired'
          starts_at?: string
          renews_at?: string | null
          amount?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          plan_id?: string
          status?: 'active' | 'trial' | 'suspended' | 'expired'
          starts_at?: string
          renews_at?: string | null
          amount?: number
          created_at?: string
          updated_at?: string
        }
      }
      saas_audit_logs: {
        Row: {
          id: string
          actor_user_id: string | null
          org_id: string | null
          action: string
          metadata: Json
          ip: string | null
          created_at: string
        }
        Insert: {
          id?: string
          actor_user_id?: string | null
          org_id?: string | null
          action: string
          metadata?: Json
          ip?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          actor_user_id?: string | null
          org_id?: string | null
          action?: string
          metadata?: Json
          ip?: string | null
          created_at?: string
        }
      }
      saas_impersonations: {
        Row: {
          id: string
          super_admin_id: string
          org_id: string
          started_at: string
          ended_at: string | null
        }
        Insert: {
          id?: string
          super_admin_id: string
          org_id: string
          started_at?: string
          ended_at?: string | null
        }
        Update: {
          id?: string
          super_admin_id?: string
          org_id?: string
          started_at?: string
          ended_at?: string | null
        }
      }
      global_settings: {
        Row: {
          id: boolean
          platform_name: string
          logo_url: string | null
          primary_color: string
          global_limits: Json
          ai_config: Json
          whatsapp_config: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          platform_name?: string
          logo_url?: string | null
          primary_color?: string
          global_limits?: Json
          ai_config?: Json
          whatsapp_config?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          platform_name?: string
          logo_url?: string | null
          primary_color?: string
          global_limits?: Json
          ai_config?: Json
          whatsapp_config?: Json
          updated_at?: string
          updated_by?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_super_admin: {
        Args: {
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      platform_role: 'SUPER_ADMIN'
      organization_status: 'active' | 'trial' | 'suspended'
      subscription_status: 'active' | 'trial' | 'suspended' | 'expired'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (Database['public']['Tables'] & Database['public']['Views'])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions['schema']]['Tables'] &
        Database[PublicTableNameOrOptions['schema']]['Views'])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions['schema']]['Tables'] &
      Database[PublicTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (Database['public']['Tables'] &
        Database['public']['Views'])
    ? (Database['public']['Tables'] &
        Database['public']['Views'])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof Database['public']['Tables']
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof Database['public']['Tables']
    ? Database['public']['Tables'][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof Database['public']['Tables']
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof Database['public']['Tables']
    ? Database['public']['Tables'][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof Database['public']['Enums']
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions['schema']]['Enums'][EnumName]
  : PublicEnumNameOrOptions extends keyof Database['public']['Enums']
    ? Database['public']['Enums'][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof Database['public']['CompositeTypes']
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof Database['public']['CompositeTypes']
    ? Database['public']['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never
