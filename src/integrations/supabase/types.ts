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
      ai_actions_log: {
        Row: {
          action_details: string
          action_name: string
          created_at: string | null
          id: string
          org_id: string
          thread_id: string
        }
        Insert: {
          action_details: string
          action_name: string
          created_at?: string | null
          id?: string
          org_id: string
          thread_id: string
        }
        Update: {
          action_details?: string
          action_name?: string
          created_at?: string | null
          id?: string
          org_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_actions_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_actions_log_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_configs: {
        Row: {
          enabled: boolean
          grok_api_key: string | null
          knowledge_base: string
          model: string
          openai_api_key: string | null
          org_id: string
          provider: string
          respond_to: string
          selected_provider: string | null
          system_prompt: string
          updated_at: string
          vertex_location: string | null
          vertex_model: string | null
          vertex_project: string | null
          vertex_service_account_json: string | null
        }
        Insert: {
          enabled?: boolean
          grok_api_key?: string | null
          knowledge_base?: string
          model?: string
          openai_api_key?: string | null
          org_id: string
          provider?: string
          respond_to?: string
          selected_provider?: string | null
          system_prompt?: string
          updated_at?: string
          vertex_location?: string | null
          vertex_model?: string | null
          vertex_project?: string | null
          vertex_service_account_json?: string | null
        }
        Update: {
          enabled?: boolean
          grok_api_key?: string | null
          knowledge_base?: string
          model?: string
          openai_api_key?: string | null
          org_id?: string
          provider?: string
          respond_to?: string
          selected_provider?: string | null
          system_prompt?: string
          updated_at?: string
          vertex_location?: string | null
          vertex_model?: string | null
          vertex_project?: string | null
          vertex_service_account_json?: string | null
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
          action_add_tags: string[] | null
          action_ai_behavior: string | null
          action_remove_tags: string[] | null
          chain_to_rule_id: string | null
          cooldown_seconds: number
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          last_triggered_at: string | null
          limit_per_contact: number | null
          match_type: string
          match_value: string
          media_url: string | null
          mime_type: string | null
          name: string
          no_response_ai_scope: string
          no_response_delay_seconds: number
          no_response_tag_id: string | null
          org_id: string
          reply_text: string | null
          session_id: string | null
          trigger_type: string | null
          updated_at: string
        }
        Insert: {
          action_add_tags?: string[] | null
          action_ai_behavior?: string | null
          action_remove_tags?: string[] | null
          chain_to_rule_id?: string | null
          cooldown_seconds?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          limit_per_contact?: number | null
          match_type?: string
          match_value: string
          media_url?: string | null
          mime_type?: string | null
          name: string
          no_response_ai_scope?: string
          no_response_delay_seconds?: number
          no_response_tag_id?: string | null
          org_id: string
          reply_text?: string | null
          session_id?: string | null
          trigger_type?: string | null
          updated_at?: string
        }
        Update: {
          action_add_tags?: string[] | null
          action_ai_behavior?: string | null
          action_remove_tags?: string[] | null
          chain_to_rule_id?: string | null
          cooldown_seconds?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          limit_per_contact?: number | null
          match_type?: string
          match_value?: string
          media_url?: string | null
          mime_type?: string | null
          name?: string
          no_response_ai_scope?: string
          no_response_delay_seconds?: number
          no_response_tag_id?: string | null
          org_id?: string
          reply_text?: string | null
          session_id?: string | null
          trigger_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_replies_chain_to_rule_id_fkey"
            columns: ["chain_to_rule_id"]
            isOneToOne: false
            referencedRelation: "auto_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_replies_no_response_tag_id_fkey"
            columns: ["no_response_tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_reply_steps: {
        Row: {
          cooldown_seconds: number
          created_at: string
          id: string
          media_url: string | null
          mime_type: string | null
          org_id: string
          rule_id: string
          step_order: number
          text_content: string | null
          updated_at: string
        }
        Insert: {
          cooldown_seconds?: number
          created_at?: string
          id?: string
          media_url?: string | null
          mime_type?: string | null
          org_id: string
          rule_id: string
          step_order?: number
          text_content?: string | null
          updated_at?: string
        }
        Update: {
          cooldown_seconds?: number
          created_at?: string
          id?: string
          media_url?: string | null
          mime_type?: string | null
          org_id?: string
          rule_id?: string
          step_order?: number
          text_content?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_reply_steps_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "auto_replies"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_reply_triggers: {
        Row: {
          contact_id: string
          id: string
          org_id: string
          rule_id: string
          triggered_at: string | null
        }
        Insert: {
          contact_id: string
          id?: string
          org_id: string
          rule_id: string
          triggered_at?: string | null
        }
        Update: {
          contact_id?: string
          id?: string
          org_id?: string
          rule_id?: string
          triggered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_reply_triggers_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_reply_triggers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_reply_triggers_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "auto_replies"
            referencedColumns: ["id"]
          },
        ]
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
          error_log: string | null
          failed_count: number
          finished_at: string | null
          id: string
          media_url: string | null
          message_text: string
          mime_type: string | null
          name: string
          org_id: string
          rate_per_minute: number
          scheduled_at: string | null
          sent_count: number
          session_id: string
          started_at: string | null
          status: string
          tag_id: string | null
          total_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_log?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          media_url?: string | null
          message_text: string
          mime_type?: string | null
          name: string
          org_id: string
          rate_per_minute?: number
          scheduled_at?: string | null
          sent_count?: number
          session_id: string
          started_at?: string | null
          status?: string
          tag_id?: string | null
          total_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_log?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          media_url?: string | null
          message_text?: string
          mime_type?: string | null
          name?: string
          org_id?: string
          rate_per_minute?: number
          scheduled_at?: string | null
          sent_count?: number
          session_id?: string
          started_at?: string | null
          status?: string
          tag_id?: string | null
          total_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcasts_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_integrations: {
        Row: {
          cached_tenant_id: string | null
          created_at: string
          id: string
          is_active: boolean
          last_sync_count: number | null
          last_sync_error: string | null
          last_synced_at: string | null
          last_test_at: string | null
          last_test_message: string | null
          last_test_ok: boolean | null
          name: string
          org_id: string
          products_table: string
          publishable_key: string
          send_media: boolean
          slug: string
          status: string
          supabase_url: string
          tenant_id: string | null
          tenants_table: string
          updated_at: string
        }
        Insert: {
          cached_tenant_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_count?: number | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          name?: string
          org_id: string
          products_table?: string
          publishable_key?: string
          send_media?: boolean
          slug?: string
          status?: string
          supabase_url?: string
          tenant_id?: string | null
          tenants_table?: string
          updated_at?: string
        }
        Update: {
          cached_tenant_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_sync_count?: number | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          name?: string
          org_id?: string
          products_table?: string
          publishable_key?: string
          send_media?: boolean
          slug?: string
          status?: string
          supabase_url?: string
          tenant_id?: string | null
          tenants_table?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_sync_logs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          integration_id: string
          org_id: string
          products_failed: number | null
          products_synced: number | null
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          integration_id: string
          org_id: string
          products_failed?: number | null
          products_synced?: number | null
          status: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          integration_id?: string
          org_id?: string
          products_failed?: number | null
          products_synced?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_sync_logs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "catalog_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_sync_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          assigned_at: string | null
          contact_id: string
          tag_id: string
        }
        Insert: {
          assigned_at?: string | null
          contact_id: string
          tag_id: string
        }
        Update: {
          assigned_at?: string | null
          contact_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          org_id: string
          phone: string | null
          pipeline_stage_id: string | null
          profile_picture_url: string | null
          updated_at: string
          wa_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          org_id: string
          phone?: string | null
          pipeline_stage_id?: string | null
          profile_picture_url?: string | null
          updated_at?: string
          wa_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          org_id?: string
          phone?: string | null
          pipeline_stage_id?: string | null
          profile_picture_url?: string | null
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
          {
            foreignKeyName: "contacts_pipeline_stage_id_fkey"
            columns: ["pipeline_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
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
          scheduled_for: string | null
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
          scheduled_for?: string | null
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
          scheduled_for?: string | null
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
      flow_runs: {
        Row: {
          contact_id: string
          created_at: string | null
          current_step_id: string | null
          flow_id: string
          id: string
          last_interaction_at: string | null
          next_execution_at: string | null
          org_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          current_step_id?: string | null
          flow_id: string
          id?: string
          last_interaction_at?: string | null
          next_execution_at?: string | null
          org_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          current_step_id?: string | null
          flow_id?: string
          id?: string
          last_interaction_at?: string | null
          next_execution_at?: string | null
          org_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flow_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_current_step_id_fkey"
            columns: ["current_step_id"]
            isOneToOne: false
            referencedRelation: "flow_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_steps: {
        Row: {
          branch: string | null
          created_at: string | null
          flow_id: string
          id: string
          parent_step_id: string | null
          step_data: Json
          step_order: number
          step_type: string
        }
        Insert: {
          branch?: string | null
          created_at?: string | null
          flow_id: string
          id?: string
          parent_step_id?: string | null
          step_data?: Json
          step_order: number
          step_type: string
        }
        Update: {
          branch?: string | null
          created_at?: string | null
          flow_id?: string
          id?: string
          parent_step_id?: string | null
          step_data?: Json
          step_order?: number
          step_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_steps_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_steps_parent_step_id_fkey"
            columns: ["parent_step_id"]
            isOneToOne: false
            referencedRelation: "flow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          ai_can_access_crm: boolean | null
          ai_can_access_tags: boolean | null
          ai_custom_system_prompt: string | null
          ai_enabled_after_flow: boolean | null
          ai_enabled_during_flow: boolean | null
          ai_fallback_enabled: boolean | null
          ai_knowledge_sources: Json | null
          ai_maintain_context: boolean | null
          ai_mode: string | null
          ai_time_limit_minutes: number | null
          ai_transfer_on_failure: boolean | null
          ai_transfer_rules: Json | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          trigger_type: string
          trigger_value: string | null
        }
        Insert: {
          ai_can_access_crm?: boolean | null
          ai_can_access_tags?: boolean | null
          ai_custom_system_prompt?: string | null
          ai_enabled_after_flow?: boolean | null
          ai_enabled_during_flow?: boolean | null
          ai_fallback_enabled?: boolean | null
          ai_knowledge_sources?: Json | null
          ai_maintain_context?: boolean | null
          ai_mode?: string | null
          ai_time_limit_minutes?: number | null
          ai_transfer_on_failure?: boolean | null
          ai_transfer_rules?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          trigger_type: string
          trigger_value?: string | null
        }
        Update: {
          ai_can_access_crm?: boolean | null
          ai_can_access_tags?: boolean | null
          ai_custom_system_prompt?: string | null
          ai_enabled_after_flow?: boolean | null
          ai_enabled_during_flow?: boolean | null
          ai_fallback_enabled?: boolean | null
          ai_knowledge_sources?: Json | null
          ai_maintain_context?: boolean | null
          ai_mode?: string | null
          ai_time_limit_minutes?: number | null
          ai_transfer_on_failure?: boolean | null
          ai_transfer_rules?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          trigger_type?: string
          trigger_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_sources: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          name: string
          org_id: string
          source_type: string
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          name: string
          org_id: string
          source_type: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          name?: string
          org_id?: string
          source_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_ingest_tokens: {
        Row: {
          created_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          address: string | null
          campaign_name: string | null
          category: string | null
          city: string | null
          created_at: string | null
          email: string | null
          has_photos: boolean | null
          id: string
          maps_category: string | null
          message_broadcast_id: string | null
          message_sent_at: string | null
          name: string
          open_status: string | null
          phone: string
          phone_normalized: string | null
          rating: number | null
          raw: Json | null
          review_count: number | null
          scraped_at: string | null
          source: string | null
          updated_at: string | null
          user_id: string
          website: string | null
          zone: string | null
        }
        Insert: {
          address?: string | null
          campaign_name?: string | null
          category?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          has_photos?: boolean | null
          id?: string
          maps_category?: string | null
          message_broadcast_id?: string | null
          message_sent_at?: string | null
          name?: string
          open_status?: string | null
          phone?: string
          phone_normalized?: string | null
          rating?: number | null
          raw?: Json | null
          review_count?: number | null
          scraped_at?: string | null
          source?: string | null
          updated_at?: string | null
          user_id: string
          website?: string | null
          zone?: string | null
        }
        Update: {
          address?: string | null
          campaign_name?: string | null
          category?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          has_photos?: boolean | null
          id?: string
          maps_category?: string | null
          message_broadcast_id?: string | null
          message_sent_at?: string | null
          name?: string
          open_status?: string | null
          phone?: string
          phone_normalized?: string | null
          rating?: number | null
          raw?: Json | null
          review_count?: number | null
          scraped_at?: string | null
          source?: string | null
          updated_at?: string | null
          user_id?: string
          website?: string | null
          zone?: string | null
        }
        Relationships: []
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
      no_response_pending: {
        Row: {
          cancelled_at: string | null
          chat_id: string | null
          contact_id: string | null
          created_at: string
          fired_at: string | null
          fires_at: string
          id: string
          org_id: string
          rule_id: string
          session_id: string | null
          thread_id: string
        }
        Insert: {
          cancelled_at?: string | null
          chat_id?: string | null
          contact_id?: string | null
          created_at?: string
          fired_at?: string | null
          fires_at: string
          id?: string
          org_id: string
          rule_id: string
          session_id?: string | null
          thread_id: string
        }
        Update: {
          cancelled_at?: string | null
          chat_id?: string | null
          contact_id?: string | null
          created_at?: string
          fired_at?: string | null
          fires_at?: string
          id?: string
          org_id?: string
          rule_id?: string
          session_id?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "no_response_pending_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "no_response_pending_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "auto_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "no_response_pending_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          contact_id: string
          content: string
          created_at: string | null
          id: string
          org_id: string
          user_id: string | null
        }
        Insert: {
          contact_id: string
          content: string
          created_at?: string | null
          id?: string
          org_id: string
          user_id?: string | null
        }
        Update: {
          contact_id?: string
          content?: string
          created_at?: string | null
          id?: string
          org_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_fields: {
        Row: {
          created_at: string | null
          display_order: number | null
          field_type: string | null
          id: string
          is_required: boolean | null
          name: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          field_type?: string | null
          id?: string
          is_required?: boolean | null
          name: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          field_type?: string | null
          id?: string
          is_required?: boolean | null
          name?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_fields_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          contact_id: string | null
          created_at: string | null
          form_data: Json | null
          id: string
          org_id: string
          status: string | null
          thread_id: string | null
          updated_at: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          form_data?: Json | null
          id?: string
          org_id: string
          status?: string | null
          thread_id?: string | null
          updated_at?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          form_data?: Json | null
          id?: string
          org_id?: string
          status?: string | null
          thread_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_thread_id_fkey"
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
      pipeline_stages: {
        Row: {
          color: string
          created_at: string | null
          id: string
          name: string
          org_id: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string | null
          id?: string
          name: string
          org_id: string
          position: number
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: string
          name?: string
          org_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          badge: string | null
          created_at: string | null
          description: string | null
          external_id: string
          id: string
          image_url: string | null
          integration_id: string | null
          is_active: boolean | null
          name: string
          org_id: string
          price: number | null
          raw: Json | null
          sku: string | null
          slug: string | null
          stock: number | null
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          badge?: string | null
          created_at?: string | null
          description?: string | null
          external_id: string
          id?: string
          image_url?: string | null
          integration_id?: string | null
          is_active?: boolean | null
          name: string
          org_id: string
          price?: number | null
          raw?: Json | null
          sku?: string | null
          slug?: string | null
          stock?: number | null
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          badge?: string | null
          created_at?: string | null
          description?: string | null
          external_id?: string
          id?: string
          image_url?: string | null
          integration_id?: string | null
          is_active?: boolean | null
          name?: string
          org_id?: string
          price?: number | null
          raw?: Json | null
          sku?: string | null
          slug?: string | null
          stock?: number | null
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      quick_replies: {
        Row: {
          created_at: string
          id: string
          media_url: string | null
          mime_type: string | null
          org_id: string
          shortcut: string
          text_content: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_url?: string | null
          mime_type?: string | null
          org_id: string
          shortcut: string
          text_content: string
        }
        Update: {
          created_at?: string
          id?: string
          media_url?: string | null
          mime_type?: string | null
          org_id?: string
          shortcut?: string
          text_content?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          contact_id: string
          created_at: string | null
          id: string
          is_completed: boolean | null
          note: string
          org_id: string
          reminder_at: string
          user_id: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          id?: string
          is_completed?: boolean | null
          note: string
          org_id: string
          reminder_at: string
          user_id?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          id?: string
          is_completed?: boolean | null
          note?: string
          org_id?: string
          reminder_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      tags: {
        Row: {
          color: string
          created_at: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          color?: string
          created_at?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      threads: {
        Row: {
          ai_enabled: boolean
          assigned_to_user_id: string | null
          contact_id: string
          created_at: string
          id: string
          last_message_at: string | null
          org_id: string
          purchase_intent: string | null
          session_id: string
          unread_count: number
        }
        Insert: {
          ai_enabled?: boolean
          assigned_to_user_id?: string | null
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          org_id: string
          purchase_intent?: string | null
          session_id: string
          unread_count?: number
        }
        Update: {
          ai_enabled?: boolean
          assigned_to_user_id?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          org_id?: string
          purchase_intent?: string | null
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
      transfer_rules: {
        Row: {
          condition_config: Json | null
          condition_type: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
        }
        Insert: {
          condition_config?: Json | null
          condition_type: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
        }
        Update: {
          condition_config?: Json | null
          condition_type?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          battery_level: number | null
          created_at: string
          created_by: string | null
          default_agent_id: string | null
          default_flow_id: string | null
          device_name: string | null
          id: string
          label: string
          last_heartbeat_at: string | null
          last_sync_at: string | null
          me_wa_id: string | null
          org_id: string
          phone_number: string | null
          platform: string | null
          session_token: string
          status: Database["public"]["Enums"]["wa_session_status"]
        }
        Insert: {
          battery_level?: number | null
          created_at?: string
          created_by?: string | null
          default_agent_id?: string | null
          default_flow_id?: string | null
          device_name?: string | null
          id?: string
          label?: string
          last_heartbeat_at?: string | null
          last_sync_at?: string | null
          me_wa_id?: string | null
          org_id: string
          phone_number?: string | null
          platform?: string | null
          session_token: string
          status?: Database["public"]["Enums"]["wa_session_status"]
        }
        Update: {
          battery_level?: number | null
          created_at?: string
          created_by?: string | null
          default_agent_id?: string | null
          default_flow_id?: string | null
          device_name?: string | null
          id?: string
          label?: string
          last_heartbeat_at?: string | null
          last_sync_at?: string | null
          me_wa_id?: string | null
          org_id?: string
          phone_number?: string | null
          platform?: string | null
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
      delete_flow_step_safe: {
        Args: { p_org_id: string; p_step_id: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_broadcast_failed: {
        Args: { p_broadcast_id: string }
        Returns: undefined
      }
      increment_broadcast_sent: {
        Args: { p_broadcast_id: string }
        Returns: undefined
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
