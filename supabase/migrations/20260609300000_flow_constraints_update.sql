-- Actualiza las restricciones de tipos de trigger y step en el motor de flujos

ALTER TABLE public.flows
  DROP CONSTRAINT IF EXISTS flows_trigger_type_check;

ALTER TABLE public.flows
  ADD CONSTRAINT flows_trigger_type_check CHECK (
    trigger_type IN (
      'keyword',
      'tag_added',
      'tag_removed',
      'new_contact',
      'manual',
      'mapleads_new_prospect',
      'mapleads_imported',
      'wa_new_message',
      'wa_first_conversation',
      'wa_customer_reply',
      'pipeline_changed',
      'stage_changed',
      'ai_enabled',
      'ai_disabled',
      'purchase_made',
      'quote_sent'
    )
  );

ALTER TABLE public.flow_steps
  DROP CONSTRAINT IF EXISTS flow_steps_step_type_check;

ALTER TABLE public.flow_steps
  ADD CONSTRAINT flow_steps_step_type_check CHECK (
    step_type IN (
      'send_message',
      'send_text',
      'send_image',
      'send_video',
      'send_document',
      'send_catalog',
      'send_product',
      'wait',
      'ai_enable',
      'ai_disable',
      'ai_transfer_human',
      'ai_change_profile',
      'add_tag',
      'tag_add',
      'remove_tag',
      'tag_remove',
      'pipeline_move',
      'note_create',
      'assign_user',
      'condition_reply',
      'if_has_tag',
      'if_not_has_tag',
      'if_bought',
      'if_replied',
      'goto_flow',
      'end_flow'
    )
  );
