export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_configs: {
        Row: {
          enabled: boolean
          knowledge_base: string
          model: string
          org_id: string
          provider: string
          respond_to: string
          system_prompt: string
          updated_at: string
          vertex_location: string | null
          vertex_model: string | null
          vertex_project: string | null
        }
        Insert: {
          enabled?: boolean
          knowledge_base?: string
          model?: string
          org_id: string
          provider?: string
          respond_to?: string
          system_prompt?: string
          updated_at?: string
          vertex_location?: string | null
          vertex_model?: string | null
          vertex_project?: string | null
        }
        Update: {
          enabled?: boolean
          knowledge_base?: string
          model?: string
          org_id?: string
          provider?: string
          respond_to?: string
          system_prompt?: string
          updated_at?: string
          vertex_location?: string | null
          vertex_model?: string | null
          vertex_project?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_replies: {
        Row: {
          cooldown_seconds: number
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          last_triggered_at: string | null
          match_type: string
          match_value: string
          name: string
          org_id: string
          reply_text: string
          session_id: string | null
          updated_at: string
        }
        Insert: {
          cooldown_seconds?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          match_type?: string
          match_value: string
          name: string
          org_id: string
          reply_text: string
          session_id?: string | null
          updated_at?: string
        }
        Update: {
          cooldown_seconds?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          match_type?: string
          match_value?: string
          name?: string
          org_id?: string
          reply_text?: string
          session_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      broadcast_recipients: {
        Row: {
          broadcast_id: string
          command_id: string | null
          contact_id: string | null
          created_at: string
          error: string | null
          id: string
          org_id: string
          sent_at: string | null
          status: string
          wa_id: string
        }
        Insert: {
          broadcast_id: string
          command_id?: string | null
          contact_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          org_id: string
          sent_at?: string | null
          status?: string
          wa_id: string
        }
        Update: {
          broadcast_id?: string
          command_id?: string | null
          contact_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          org_id?: string
          sent_at?: string | null
          status?: string
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          created_at: string
          created_by: string | null
          failed_count: number
          finished_at: string | null
          id: string
          message_text: string
          name: string
          org_id: string
          rate_per_minute: number
          scheduled_at: string | null
          sent_count: number
          session_id: string
          started_at: string | null
          status: string
          total_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          message_text: string
          name: string
          org_id: string
          rate_per_minute?: number
          scheduled_at?: string | null
          sent_count?: number
          session_id: string
          started_at?: string | null
          status?: string
          total_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          message_text?: string
          name?: string
          org_id?: string
          rate_per_minute?: number
          scheduled_at?: string | null
          sent_count?: number
          session_id?: string
          started_at?: string | null
          status?: string
          total_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          org_id: string
          phone: string | null
          updated_at: string
          wa_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          org_id: string
          phone?: string | null
          updated_at?: string
          wa_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          org_id?: string
          phone?: string | null
          updated_at?: string
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      engine_commands: {
        Row: {
          ack: Json | null
          acked_at: string | null
          attempts: number
          created_at: string
          delivered_at: string | null
          id: string
          org_id: string
          payload: Json
          session_id: string
          status: Database["public"]["Enums"]["command_status"]
          type: string
        }
        Insert: {
          ack?: Json | null
          acked_at?: string | null
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          id?: string
          org_id: string
          payload?: Json
          session_id: string
          status?: Database["public"]["Enums"]["command_status"]
          type: string
        }
        Update: {
          ack?: Json | null
          acked_at?: string | null
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          id?: string
          org_id?: string
          payload?: Json
          session_id?: string
          status?: Database["public"]["Enums"]["command_status"]
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "engine_commands_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engine_commands_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          id: string
          org_id: string | null
          payload: Json
          session_id: string | null
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id?: string | null
          payload?: Json
          session_id?: string | null
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string | null
          payload?: Json
          session_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
          media: Json | null
          org_id: string
          raw: Json | null
          sent_at: string
          text: string | null
          thread_id: string
          wa_message_id: string | null
        }
        Insert: {
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
          media?: Json | null
          org_id: string
          raw?: Json | null
          sent_at?: string
          text?: string | null
          thread_id: string
          wa_message_id?: string | null
        }
        Update: {
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
          media?: Json | null
          org_id?: string
          raw?: Json | null
          sent_at?: string
          text?: string | null
          thread_id?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      scheduled_messages: {
        Row: {
          command_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          org_id: string
          send_at: string
          sent_at: string | null
          session_id: string
          status: string
          text: string
          updated_at: string
          wa_id: string
        }
        Insert: {
          command_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          org_id: string
          send_at: string
          sent_at?: string | null
          session_id: string
          status?: string
          text: string
          updated_at?: string
          wa_id: string
        }
        Update: {
          command_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          org_id?: string
          send_at?: string
          sent_at?: string | null
          session_id?: string
          status?: string
          text?: string
          updated_at?: string
          wa_id?: string
        }
        Relationships: []
      }
      threads: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          last_message_at: string | null
          org_id: string
          session_id: string
          unread_count: number
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          org_id: string
          session_id: string
          unread_count?: number
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          org_id?: string
          session_id?: string
          unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          last_heartbeat_at: string | null
          me_wa_id: string | null
          org_id: string
          session_token: string
          status: Database["public"]["Enums"]["wa_session_status"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          last_heartbeat_at?: string | null
          me_wa_id?: string | null
          org_id: string
          session_token: string
          status?: Database["public"]["Enums"]["wa_session_status"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          last_heartbeat_at?: string | null
          me_wa_id?: string | null
          org_id?: string
          session_token?: string
          status?: Database["public"]["Enums"]["wa_session_status"]
        }
        Relationships: [
          {
            foreignKeyName: "wa_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "agent"
      command_status: "pending" | "delivered" | "acked" | "failed"
      message_direction: "in" | "out"
      wa_session_status: "pending" | "connected" | "disconnected" | "error"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "agent"],
      command_status: ["pending", "delivered", "acked", "failed"],
      message_direction: ["in", "out"],
      wa_session_status: ["pending", "connected", "disconnected", "error"],
    },
  },
} as const
