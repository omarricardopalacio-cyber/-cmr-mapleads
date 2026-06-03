-- Ampliación de la tabla flow_runs
ALTER TABLE "public"."flow_runs" 
ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "error" text;

-- Creación de la tabla flow_templates
CREATE TABLE IF NOT EXISTS "public"."flow_templates" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "slug" text NOT NULL UNIQUE,
    "name" text NOT NULL,
    "trigger_type" text NOT NULL,
    "steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY ("id")
);

-- RLS y Permisos para flow_templates
ALTER TABLE "public"."flow_templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON "public"."flow_templates"
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (true);

GRANT SELECT ON TABLE "public"."flow_templates" TO "authenticated";
GRANT SELECT ON TABLE "public"."flow_templates" TO "anon";
GRANT ALL ON TABLE "public"."flow_templates" TO "service_role";

-- Índice para el Scheduler (para buscar rápidamente tareas pendientes)
CREATE INDEX IF NOT EXISTS "idx_flow_runs_due" ON "public"."flow_runs" USING btree ("next_execution_at") WHERE ("status" IN ('running', 'wait_node'));

-- Insertar plantillas semilla (Prospección, Venta, Postventa)
INSERT INTO "public"."flow_templates" ("slug", "name", "trigger_type", "steps") VALUES
(
    'prospeccion-mapleads',
    'Prospección Mapleads',
    'mapleads_new_prospect',
    '[
        {"step_type": "wait", "step_order": 1, "step_data": {"amount": 5, "unit": "minutes"}},
        {"step_type": "send_message", "step_order": 2, "step_data": {"text": "¡Hola! Vi tu negocio en Google Maps y me encantaría hablar contigo sobre cómo podemos ayudarte."}},
        {"step_type": "wait", "step_order": 3, "step_data": {"amount": 1, "unit": "days"}},
        {"step_type": "condition_reply", "step_order": 4, "step_data": {}},
        {"step_type": "add_tag", "step_order": 5, "parent_step_order": 4, "branch": "yes", "step_data": {"tag_name": "Interesado"}},
        {"step_type": "send_message", "step_order": 6, "parent_step_order": 4, "branch": "no", "step_data": {"text": "¿Pudiste ver mi mensaje anterior? Quedo atento a tus comentarios."}}
    ]'::jsonb
) ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "public"."flow_templates" ("slug", "name", "trigger_type", "steps") VALUES
(
    'venta',
    'Venta Inicial',
    'new_contact',
    '[
        {"step_type": "send_message", "step_order": 1, "step_data": {"text": "¡Hola! Gracias por contactarnos. ¿En qué podemos ayudarte hoy?"}},
        {"step_type": "wait", "step_order": 2, "step_data": {"amount": 2, "unit": "hours"}},
        {"step_type": "toggle_ai", "step_order": 3, "step_data": {"ai_enabled": true}}
    ]'::jsonb
) ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "public"."flow_templates" ("slug", "name", "trigger_type", "steps") VALUES
(
    'postventa',
    'Seguimiento Postventa',
    'stage_changed',
    '[
        {"step_type": "wait", "step_order": 1, "step_data": {"amount": 7, "unit": "days"}},
        {"step_type": "send_message", "step_order": 2, "step_data": {"text": "¡Hola! Esperamos que estés disfrutando tu compra. ¿Tienes alguna duda?"}},
        {"step_type": "add_tag", "step_order": 3, "step_data": {"tag_name": "Seguimiento_Completado"}}
    ]'::jsonb
) ON CONFLICT ("slug") DO NOTHING;
