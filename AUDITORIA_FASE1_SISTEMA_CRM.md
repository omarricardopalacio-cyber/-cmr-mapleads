# Auditoría Técnica FASE 1 — Sistema CRM Conversacional WhatsApp + IA

**Fecha:** 15/06/2026
**Proyecto:** plan-maestro-bridge-e50a0f47
**Propsósito:** Documentación exhaustiva del sistema actual SIN modificaciones. Base para FASE 2 (correcciones) y FASE 3 (features).

---

## Índice

1. Resumen Ejecutivo
2. Stack Tecnológico
3. Arquitectura General
4. Modelo de Datos (Inventario Completo de Tablas)
5. Flujo de Mensajes (Ciclo Completo)
6. Sistema de IA
7. Motor de Flujos (Flow Engine)
8. Sistema de Auto-Respuestas y No-Response
9. Catálogo de Productos
10. Mapleads (Prospección Externa)
11. Sistema de Broadcasts
12. Retry Manager (Reintentos IA)
13. Workers (Cron Jobs)
14. API Routes (Inventario Completo)
15. Problemas, Riesgos y Cuellos de Botella
16. Recomendaciones para FASE 2

---

## 1. Resumen Ejecutivo

Sistema CRM conversacional multicanal con foco en WhatsApp, construido sobre **TanStack Start (React 19 + SSR)** con backend **Supabase (PostgreSQL)**. La extensión Chrome "WhatsApp Bridge" (repositorio separado `plan-maestro-crm`) se conecta via long-polling a `engine_commands` para enviar/recibir mensajes.

**Puntos críticos identificados:**
- `ingest.ts` es un monolítico de ~1530 líneas con lógica de routing, IA, flujos, etiquetas, órdenes, etc. todo mezclado.
- `ai.server.ts` es ~7000 líneas con prompt construction, tool calling, catálogo, etc.
- No hay RAG implementado; `selectRelevantText()` es keyword scoring.
- `intent-classifier.ts` es puramente regex.
- `HISTORY_WINDOW=40` mensajes máximos en prompt IA.
- `ASYNC_AI_REPLY=false` → la IA se ejecuta síncrona en el request de ingesta.
- `no_response_pending` no tiene limpieza automática de registros cancelados/expirados.
- Múltiples `@ts-nocheck` en archivos clave.
- No hay tests automatizados detectados.

---

## 2. Stack Tecnológico

| Componente | Tecnología |
|---|---|
| **Framework** | TanStack Start (React 19 + SSR) |
| **Lenguaje** | TypeScript (con varios `@ts-nocheck`) |
| **Base de Datos** | Supabase PostgreSQL |
| **ORM/Cliente DB** | `supabaseAdmin` (cliente server-side) |
| **Autenticación** | Supabase Auth (JWT) + RLS |
| **Validación** | Zod (esquemas en server functions) |
| **IA Proveedores** | Lovable AI Gateway, Vertex AI, OpenAI, Groq |
| **Catálogo Externo** | Supabase externo vía PostgREST |
| **Chrome Extension** | plan-maestro-crm / maple-wa-engine (repo separado) |
| **Workers** | pg_cron (Supabase) → HTTP endpoints internos |
| **Media Storage** | Supabase Storage (bucket `auto-reply-media`) |
| **Cron Jobs** | Vercel Cron + pg_cron |

---

## 3. Arquitectura General

```
[Chrome Extension] ←→ [Engine Commands API] ←→ [Supabase DB]
       ↑                        ↓
       |                   [Ingest API]
       |                        ↓
       |              [Flow Trigger] → [Flow Runner]
       |                        ↓
       |              [AI Server] → [Lovable/Vertex/OpenAI/Groq]
       |                        ↓
       |              [Catalog API] → [Supabase Externo]
       |                        ↓
       |              [Auto-Reply Worker]
       |                        ↓
       |              [Retry Processor]
       |                        ↓
       |              [Broadcast Dispatcher]
```

### Capas del Sistema

1. **Capa de Ingesta** (`/api/public/engine/ingest.ts`, `/api/public/mapleads/ingest.ts`)
2. **Capa de IA** (`ai.server.ts`, `intent-classifier.ts`, `catalog.server.ts`, `catalog-search.ts`)
3. **Capa de Flujos** (`flow-trigger.server.ts`, `flow-runner.server.ts`, `flows.functions.ts`, `flow-blocks.ts`)
4. **Capa de Sesiones WhatsApp** (`sessions.functions.ts`, `wa_sessions` table)
5. **Capa de Comunicación** (`engine_commands` polling)
6. **Capa de Workers** (`dispatch.ts`, `flow-scheduler.ts`, `no-response-worker.ts`, `retry-processor.ts`)
7. **Capa de Admin** (`failed-requests.ts`)
8. **Capa de Frontend** (Rutas TanStack, componentes React)

---

## 4. Modelo de Datos — Inventario Completo de Tablas

### 4.1 Tablas Core

| Tabla | Propósito | Columnas Clave |
|---|---|---|
| `organizations` | Organizaciones multi-tenant | id, name, slug, settings (jsonb), created_at |
| `profiles` | Perfiles de usuario | id, user_id, full_name, avatar_url, org_id |
| `user_roles` | Roles por organización | id, user_id, org_id, role (text) |
| `contacts` | Contactos/Clientes | id, org_id, wa_id, phone, display_name, email, pipeline_stage_id, profile_picture_url, custom_fields (jsonb), tags (jsonb), created_at |
| `threads` | Hilos de conversación | id, org_id, contact_id, session_id, assigned_to_user_id, ai_enabled, ai_prompt_extension, purchase_intent, last_message_at, created_at |
| `messages` | Mensajes individuales | id, thread_id, org_id, direction (in/out), text, media (jsonb), wa_message_id, sent_at, created_at |
| `wa_sessions` | Sesiones de WhatsApp conectadas | id, org_id, label, status, session_token, me_wa_id, phone_number, device_name, battery_level, platform, default_agent_id, default_flow_id, last_heartbeat_at, last_sync_at |

### 4.2 Tablas de IA

| Tabla | Propósito | Columnas Clave |
|---|---|---|
| `ai_configs` | Configuración de IA por org | id, org_id, enabled, selected_provider, model, system_prompt, temperature, max_tokens, api_key_encrypted, fallback_provider, order_logo_url, custom_prompt_*, created_at |
| `ai_profiles` | Perfiles de IA alternativos | id, org_id, name, system_prompt, provider, model, temperature |
| `ai_conversation_logs` | Log de conversaciones IA | id, org_id, thread_id, messages (jsonb), response, tokens_used, latency_ms, created_at |
| `knowledge_base` | Base de conocimiento (truncado a 4000 chars) | id, org_id, content (text), created_at |
| `knowledge_sources` | Fuentes de conocimiento externas | id, org_id, name, type, url, content (text), created_at |
| `focused_product_snapshot` | Estado persistente de catálogo para IA | id, org_id, thread_id, product_data (jsonb), updated_at |

### 4.3 Tablas de Flujos (Flow Engine)

| Tabla | Propósito | Columnas Clave |
|---|---|---|
| `flows` | Definición de flujos | id, org_id, name, trigger_type, trigger_value, description, is_active, created_at, updated_at |
| `flow_steps` | Pasos individuales de un flujo | id, flow_id, step_type, step_order, step_data (jsonb), parent_step_id, branch |
| `flow_runs` | Ejecuciones de flujos por contacto | id, org_id, flow_id, contact_id, current_step_id, status (active/running/wait_node/completed/paused/cancelled), next_execution_at, last_interaction_at, started_at, finished_at, error |
| `flow_templates` | Plantillas de flujo predefinidas | id, slug, name, trigger_type, steps (jsonb) |

### 4.4 Tablas de Automatización

| Tabla | Propósito | Columnas Clave |
|---|---|---|
| `auto_replies` | Reglas de auto-respuesta | id, org_id, name, trigger_type, trigger_keyword, is_active, no_response_delay_seconds, no_response_ai_scope, no_response_tag_id, action_add_tags, action_remove_tags, action_ai_behavior, action_ai_prompt, created_at |
| `auto_reply_steps` | Pasos de auto-respuesta | id, rule_id, step_order, text_content, media_url, mime_type, cooldown_seconds |
| `no_response_pending` | Seguimiento de no-respuesta | id, org_id, rule_id, thread_id, contact_id, session_id, chat_id, fires_at, fired_at, cancelled_at |

### 4.5 Tablas de Catálogo

| Tabla | Propósito | Columnas Clave |
|---|---|---|
| `catalog_integrations` | Config de integración catálogo externo | id, org_id, external_supabase_url, external_supabase_key, external_table_name, sync_enabled, sync_interval_minutes, last_sync_at |
| `products` | Productos sincronizados | id, org_id, external_id, name, description, price, image_url, video_url, sku, category, stock, is_available, metadata (jsonb), last_synced_at |
| `master_products` (catalogo externo) | Productos maestros del catálogo externo | id, organization_id, name, description, price, images, category, subcategory, etc. |

### 4.6 Tablas de Ventas y Órdenes

| Tabla | Propósito | Columnas Clave |
|---|---|---|
| `orders` | Pedidos generados por IA | id, org_id, contact_id, thread_id, products (jsonb), total, status (pending/confirmed/cancelled/completed), shipping_address, notes, created_at |
| `purchase_intents` | Intenciones de compra | id, org_id, thread_id, contact_id, status, product_data (jsonb), created_at |

### 4.7 Tablas de CRM

| Tabla | Propósito | Columnas Clave |
|---|---|---|
| `tags` | Etiquetas | id, org_id, name, color, created_at |
| `contact_tags` | Relación contacto-etiqueta | contact_id, tag_id |
| `pipelines` | Pipelines de ventas | id, org_id, name, stages (jsonb), created_at |
| `pipeline_stages` | Etapas de pipeline | id, pipeline_id, name, order, color |
| `notes` | Notas sobre contactos | id, org_id, contact_id, user_id, content, created_at |
| `reminders` | Recordatorios | id, org_id, user_id, contact_id, title, description, due_at, completed_at |
| `events` | Eventos de auditoría | id, org_id, session_id, type, payload (jsonb), created_at |

### 4.8 Tablas de Broadcasts

| Tabla | Propósito | Columnas Clave |
|---|---|---|
| `broadcasts` | Campañas de difusión | id, org_id, session_id, message_text, media_url, mime_type, rate_per_minute, total_count, sent_count, failed_count, status, scheduled_at, error_log |
| `broadcast_recipients` | Destinatarios de broadcast | id, broadcast_id, wa_id, status, error, command_id, sent_at |
| `scheduled_messages` | Mensajes programados | id, org_id, session_id, wa_id, text, send_at, status, sent_at, command_id, error |

### 4.9 Tablas de Mapleads

| Tabla | Propósito | Columnas Clave |
|---|---|---|
| `leads` | Prospectos de Mapleads | id, user_id, name, phone, phone_normalized, address, city, category, website, email, rating, source, campaign_name, raw (jsonb), scraped_at |
| `lead_ingest_tokens` | Tokens de autenticación Mapleads | id, user_id, token, created_at |

### 4.10 Tablas de Engine y Sistema

| Tabla | Propósito | Columnas Clave |
|---|---|---|
| `engine_commands` | Comandos para la extensión WhatsApp | id, org_id, session_id, type (SEND_MESSAGE, SEND_MEDIA, etc.), payload (jsonb), status (pending/delivered/processed/failed), attempts, scheduled_for, delivered_at, processed_at, created_at |
| `failed_ai_requests` | Reintentos de IA fallidos | id, org_id, thread_id, chat_id, session_id, original_message, error_message, retry_count, max_retries, next_retry_at, status (pending/retrying/resolved/failed), context_data |
| `organization_settings` | Config por organización | id, org_id, settings (jsonb) |

### 4.11 Tablas de Negocio y Enrutamiento

| Tabla | Propósito |
|---|---|
| `business_hours` | Horarios laborales por org |
| `routing_rules` | Reglas de enrutamiento de mensajes |
| `number_pools` | Pool de números disponibles |
| `organization_number_pool` | Asignación org-números |

---

## 5. Flujo de Mensajes — Ciclo Completo

### 5.1 Mensaje Inbound (WhatsApp → Sistema)

```
[WhatsApp] → [Chrome Extension] → [Ingest API] → [Supabase DB]
                                                    ↓
                                              [Flow Trigger]
                                                    ↓
                                              [AI Server]
                                                    ↓
                                              [Engine Commands] → [Extension] → [WhatsApp]
```

1. La extensión Chrome detecta mensaje entrante
2. Hace POST a `/api/public/engine/ingest`
3. `ingest.ts` procesa:
   - Valida token de sesión
   - Busca o crea `contact`
   - Busca o crea `thread`
   - Inserta `message` (direction='in')
   - Actualiza `thread.last_message_at`
   - Cancela `no_response_pending` si existe (respondió)
   - **Si AI está activo en el thread**: continúa flujo IA
   - **Si hay flujo activo**: actualiza `flow_runs.last_interaction_at`
   - **Clasifica intención** (purchase_intent)
   - **Procesa órdenes** (si hay datos de pedido)
   - **Ejecuta AI Agent** (runAiAgent)
   - **Inserta respuesta** como message direction='out'
   - **Encola engine_command** para que la extensión envíe
   - **Dispara flujos** si el trigger corresponde

### 5.2 Mensaje Outbound (Sistema → WhatsApp)

1. Sistema inserta `engine_command` con type='SEND_MESSAGE' o 'SEND_MEDIA'
2. Extensión Chrome hace GET a `/api/public/engine/commands` (polling)
3. Recibe comandos pendientes, los marca como 'delivered'
4. Extensión ejecuta el comando en WhatsApp Web
5. Marca como 'processed'

### 5.3 Ingest.ts Architecture (Monolítico)

El archivo `src/routes/api/public/engine/ingest.ts` (~1530 líneas) contiene:

```
POST handler:
├── Validación de token de sesión
├── Búsqueda/creación de contacto (getOrCreateContact)
├── Búsqueda/creación de thread (getOrCreateThread)
├── Inserción de mensaje entrante
├── Sistema Anti-Flood (rate limiting)
├── Manejo de comandos interactivos (menús)
├── Procesamiento de ubicación
├── Cancelación de no_response_pending
├── Límite de mensajes por contacto (limit_per_contact)
├── Verificación de AI habilitado
│   ├── Si AI desactivado → quizás trigger flow manual
│   └── Si AI activo:
│       ├── Clasificar intención (purchase_intent)
│       ├── Si es compra: procesarOrder()
│       ├── Ejecutar AI Agent (runAiAgent)
│       └── Enviar respuesta (insert message + engine_command)
├── Flujo automático (si no AI, trigger flows)
└── Error handling
```

**Problema:** Toda la lógica de routing, creación de contactos, threads, IA, flujos, órdenes, límites, etc., está en UNA sola función handler. No hay separación de responsabilidades ni middlewares.

---

## 6. Sistema de IA

### 6.1 Archivos Involucrados

| Archivo | Líneas | Propósito |
|---|---|---|
| `src/lib/ai.server.ts` | ~7000 | Core: prompt construction, tool calling, selectRelevantText |
| `src/lib/intent-classifier.ts` | ~200 | Clasificación de intención vía regex |
| `src/lib/catalog.server.ts` | ~400 | Integración catálogo externo PostgREST |
| `src/lib/catalog-search.ts` | ~500 | Normalización, typo mapping, Levenshtein |

### 6.2 Proveedores Soportados

| Proveedor | Cómo se configura |
|---|---|
| **Lovable AI Gateway** | `https://api.lovable.ai/v1/chat/completions` con API key |
| **Vertex AI** | `https://us-central1-aiplatform.googleapis.com/v1/projects/...` con token ADC |
| **OpenAI** | API estándar `https://api.openai.com/v1` |
| **Groq** | API estándar con API key |

### 6.3 Construcción del Prompt

El prompt se construye en `buildPrompt()` con estas secciones:

1. **System Prompt** (desde `ai_configs.system_prompt`)
2. **Prompt extender** (desde `ai_configs.custom_prompt_*`)
3. **Base de conocimiento** (`knowledge_base.content`, truncado a 4000 chars)
4. **Knowledge sources relevantes** (`selectRelevantKnowledgeSources()` por keyword match)
5. **Product snapshot** (`focused_product_snapshot.product_data` si existe)
6. **Catálogo completo** (de `catalog.server.ts`)
7. **Historial** (últimos `HISTORY_WINDOW=40` mensajes)
8. **Contexto del usuario** (nombre, purchase_intent, tags, pipeline stage)
9. **Intención** (clasificada por `intent-classifier.ts`)

### 6.4 Tool Calling

`runAiAgent()` ejecuta el modelo con herramientas definidas:

- `send_text` / `send_message`
- `send_image` / `send_video` / `send_document`
- `send_product_image` / `send_product_video`
- `search_catalog` / `get_product_detail`
- `get_whatsapp_catalog`
- `create_order`
- `search_knowledge_base`
- `transfer_to_human`
- `change_profile`
- `update_purchase_intent`
- `request_location`

### 6.5 Clasificador de Intención

`intent-classifier.ts` usa regex patterns para detectar:

- `saludo` → saludo inicial
- `consulta_producto` → preguntas sobre productos
- `compra` / `pedido` → intención de compra
- `precio` / `cotizacion` → consulta de precios
- `ubicacion` / `direccion` → consulta de ubicación
- `horario` / `atencion` → consulta de horarios
- `contacto` / `telefono` → consulta de contacto
- `queja` / `reclamo` → reclamos
- `gracias` → agradecimiento
- `despedida` → despedida

**Limitación:** Solo regex, no hay NLP/ML. No detecta intenciones complejas o ambiguas.

### 6.6 Catálogo

- `catalog.server.ts` obtiene productos desde un Supabase externo vía PostgREST
- Los productos se sincronizan a la tabla local `products`
- `catalog-search.ts` normaliza consultas (tildes, mayúsculas), mapea typos comunes, usa Levenshtein para fuzzy matching
- Exportaciones (logs de búsquedas) a `master_products` en el catálogo externo

### 6.7 Problemas de IA

- **No hay RAG**: `selectRelevantText()` es keyword scoring simple
- **Knowledge base truncada**: 4000 caracteres máximo
- **No hay memoria persistente**: Solo `focused_product_snapshot` sobrevive entre interacciones
- **HISTORY_WINDOW=40**: Puede exceder context window del modelo si los mensajes son largos
- **ASYNC_AI_REPLY=false**: La IA se ejecuta síncrona, bloqueando el request de ingesta
- **No hay streaming**: El agente espera respuesta completa del modelo antes de responder
- **No hay cache de respuestas**: Cada consulta similar genera viaje completo al modelo
- **Fallback provider**: Existe columna `fallback_provider` en `ai_configs` pero no se usa consistentemente

---

## 7. Motor de Flujos (Flow Engine)

### 7.1 Arquitectura

```
[Trigger Event] → [flow-trigger.server.ts] → [Crea flow_run]
                                                    ↓
[pg_cron o Vercel Cron] → [flow-scheduler.ts] → [processDueRuns()]
                                                    ↓
[dispatch.ts] → [processDueRuns()] → [processRun()] → [execStep()]
```

### 7.2 Tipos de Trigger

| Trigger | Cuándo se dispara |
|---|---|
| `mapleads_new_prospect` | Nuevo lead importado desde Mapleads |
| `mapleads_imported` | Importación batch de Mapleads |
| `new_contact` | Nuevo contacto creado |
| `wa_new_message` | Mensaje WhatsApp recibido |
| `wa_first_conversation` | Primera conversación |
| `wa_customer_reply` | Cliente respondió |
| `tag_added` / `tag_removed` | Cambio de etiquetas |
| `pipeline_changed` / `stage_changed` | Cambio de pipeline/etapa |
| `ai_enabled` / `ai_disabled` | Cambio de estado IA |
| `purchase_made` | Compra realizada |
| `quote_sent` | Cotización enviada |
| `manual` | Ejecución manual desde UI |

### 7.3 Tipos de Paso (Step)

| Step | Función |
|---|---|
| `send_text` / `send_message` | Enviar mensaje de texto |
| `send_image` / `send_video` / `send_document` | Enviar multimedia |
| `send_catalog` | Enviar catálogo |
| `send_product` | Enviar producto específico |
| `wait` | Esperar (seg/min/hrs/días/sem/mes) |
| `ai_enable` / `ai_disable` | Activar/desactivar IA |
| `ai_transfer_human` | Transferir a agente humano |
| `ai_change_profile` | Cambiar perfil de IA |
| `tag_add` / `tag_remove` | Gestión de etiquetas |
| `pipeline_move` | Mover etapa en pipeline |
| `note_create` | Crear nota |
| `assign_user` | Asignar a usuario |
| `if_has_tag` / `if_not_has_tag` | Condicional por etiqueta |
| `if_bought` | Condicional por compra |
| `if_replied` / `condition_reply` | Condicional por respuesta |
| `goto_flow` | Navegar a otro flujo |
| `end_flow` | Terminar flujo |

### 7.4 Flow Trigger (`flow-trigger.server.ts`)

- `triggerFlows()` recibe orgId, contactId, triggerType
- Busca flows activos con ese trigger_type
- Para cada flow, crea `flow_run` con status='active'
- Si el flow tiene `is_sequential_per_contact=true`, no crea duplicados
- **Problema:** No hay control de concurrencia; puede crear runs duplicados si se llama múltiples veces rápido

### 7.5 Flow Runner (`flow-runner.server.ts`)

- `processDueRuns()` ejecutado por cron cada ~1 minuto
- Busca `flow_runs` con status en ['active', 'running', 'wait_node'] y next_execution_at <= now
- `processRunUntilWaitOrCompleted()` ejecuta pasos en bucle hasta wait/completed
- Al finalizar un flow, **reactiva IA** en el thread (`ai_enabled: true`)
- Cada paso se ejecuta vía `execStep()`
- **Problema:** `processRunUntilWaitOrCompleted()` ejecuta hasta 50 iteraciones síncronas (sin timeout global)
- **Problema:** No hay límite de tiempo por ejecución de flow

### 7.6 Flow Steps (`flows.functions.ts`)

- CRUD completo via Server Functions de TanStack
- `duplicateFlow()` copia flujo y pasos con mapeo de IDs temporales -> reales
- `upsertSteps()` reemplazo total: borra todos los steps e inserta nuevos (transacción manual)
- `createFromTemplate()` crea flujo desde plantilla

---

## 8. Sistema de Auto-Respuestas y No-Response

### 8.1 Auto-Replies

- Reglas con trigger_type => keyword matching
- `auto_reply_steps` define pasos secuenciales con cooldown_seconds y media opcional
- Se ejecutan síncrona en ingest.ts cuando el mensaje entrante matchea una regla

### 8.2 No-Response Trigger

**Flujo:**
1. Cuando llega un mensaje INBOUND, ingest.ts programa un `no_response_pending` si hay reglas activas con no-response configurado
2. Worker cada 5 minutos (`pg_cron`) revisa pendings expirados (`fires_at <= now`)
3. Si cliente NO respondió desde que se programó, ejecuta los steps de la regla
4. Si cliente respondió, cancela el pending

**Problemas:**
- No hay limpieza automática de registros `cancelled_at` o `fired_at` viejos
- La lógica de `no_response_pending` está en ingest.ts (programación) y no-response-worker.ts (ejecución) — lógica duplicada
- `no_response_ai_scope` permite filtrar por estado IA, pero agrega complejidad

### 8.3 Abandoned Orders

El `no-response-worker.ts` también maneja `processAbandonedOrders()`:
- `collecting_data` > 10 min sin respuesta → reminder 1
- `collecting_data_reminded_1` > 20 min sin respuesta → reminder 2
- `collecting_data_reminded_2` > 60 min sin respuesta → `purchase_intent = 'no_compro'`
- **Problema:** Textos de recordatorios hardcodeados en Español
- **Problema:** No configurables por organización

---

## 9. Catálogo de Productos

### 9.1 Integración

- `catalog_integrations` configura conexión a Supabase externo
- Sincronización vía PostgREST
- Tabla `master_products` en el catálogo externo como fuente de verdad
- Productos se mapean a `products` local con `external_id`

### 9.2 Uso en IA

- IA puede buscar productos vía tool calling (`search_catalog`, `get_product_detail`)
- `catalog-search.ts` normaliza y hace fuzzy matching
- `focused_product_snapshot` cachea productos en conversación activa

### 9.3 Exportaciones

- Cuando IA busca productos, se registra en `master_products` como log de exportación
- Incluye: qué buscó, qué encontró, métricas de búsqueda

---

## 10. Mapleads (Prospección Externa)

### 10.1 Ingesta

- POST `/api/public/mapleads/ingest` recibe leads desde la extensión Mapleads
- Valida token vía `lead_ingest_tokens`
- Normaliza teléfonos con `normalizePhone()`
- Inserta en `leads` (con manejo de duplicados)
- Dispara flujo `mapleads_new_prospect`

### 10.2 GET Endpoint

- GET `/api/public/mapleads/ingest` — solo valida token (health check)

---

## 11. Sistema de Broadcasts

### 11.1 Dispatch

`dispatch.ts` (cada minuto via Vercel Cron):
1. **Scheduled Messages**: Mensajes con `send_at <= now` → engine_commands
2. **Broadcasts**: Procesa broadcasts en estado 'running'
   - Batch = `rate_per_minute` (por defecto 15)
   - Resuelve media (base64) antes de enviar
   - Normaliza wa_id a formato JID
3. **Flow Steps**: Ejecuta `processDueRuns()` para flujos

### 11.2 Rate Limiting

- `rate_per_minute` configurable por broadcast (default 15)
- No hay rate limiting global entre broadcasts simultáneos

---

## 12. Retry Manager

### 12.1 Componentes

- `retry-manager.server.ts` — funciones para CRUD de `failed_ai_requests`
- `retry-processor.ts` — endpoint HTTP que procesa reintentos
- `failed-requests.ts` — admin endpoint para listar/reintentar/resolver

### 12.2 Flujo de Reintento

1. IA falla en ingest.ts → `registerFailedAiRequest()` inserta registro
2. Retry processor (cada 1-5 min) obtiene pendings
3. Verifica si cliente ya respondió (si sí, resuelve sin reintentar)
4. Recupera historial de mensajes
5. Ejecuta `runAiAgent()` nuevamente
6. Si éxito: envía respuesta, marca 'resolved'
7. Si falla: incrementa retry_count, programa próximo reintento
8. Si max_retries alcanzado: envía mensaje de error al usuario

### 12.3 Timing

- Retry 1: 1 minuto después
- Retry 2+: 3 minutos después
- Max retries: 3 por defecto
- Cleanup: registros 'resolved'/'failed' > 1 hora se eliminan

---

## 13. Workers (Cron Jobs)

| Endpoint | Frecuencia | Propósito |
|---|---|---|
| `/api/public/cron/dispatch` | Cada 1 min | Scheduled msgs + Broadcasts + Flow steps |
| `/api/public/cron/flow-scheduler` | Cada 1 min (alternativo) | Solo flow steps (parcialmente duplicado) |
| `/api/internal/no-response-worker` | Cada 5 min (pg_cron) | No-response trigger + abandoned orders |
| `/api/public/engine/retry-processor` | Cada 1-5 min | Reintentos IA fallidos |

**Problema:** `dispatch.ts` y `flow-scheduler.ts` tienen lógica superpuesta para `processDueRuns()`. Ambos pueden ejecutarse simultáneamente.

---

## 14. API Routes (Inventario Completo)

| Ruta | Método | Propósito |
|---|---|---|
| `/api/public/engine/ingest` | POST | Ingesta de mensajes WhatsApp |
| `/api/public/engine/commands` | GET | Polling de comandos para extensión |
| `/api/public/engine/upload-media` | POST | Subida de medios |
| `/api/public/engine/retry-processor` | POST | Procesar reintentos IA |
| `/api/public/mapleads/ingest` | POST/GET | Ingesta de leads Mapleads |
| `/api/public/cron/dispatch` | POST/GET | Dispatcher de broadcasts + flujos |
| `/api/public/cron/flow-scheduler` | GET | Scheduler de flujos |
| `/api/internal/no-response-worker` | - | Worker de no-respuesta |
| `/api/admin/engine/failed-requests` | GET/POST/DELETE | Admin de reintentos |
| `/api/debug/media-diag` | GET | Diagnóstico de medios |

---

## 15. Problemas, Riesgos y Cuellos de Botella

### 15.1 Críticos

| # | Problema | Impacto | Archivo |
|---|---|---|---|
| C1 | **`ingest.ts` monolítico (~1530 líneas)** | Mantenibilidad nula, difícil de debuggear/extender | `ingest.ts` |
| C2 | **`ai.server.ts` (~7000 líneas)** | Archivo gigante con prompt, tools, catálogo, todo mezclado | `ai.server.ts` |
| C3 | **No hay tests automatizados** | Cada cambio es riesgo de regresión | — |
| C4 | **`@ts-nocheck` en archivos clave** | TypeScript no protege contra errores | `flow-runner.ts`, `flows.functions.ts`, `dispatch.ts`, `no-response-worker.ts`, `mapleads/ingest.ts` |
| C5 | **ASYNC_AI_REPLY=false** | IA síncrona bloquea ingesta; timeout HTTP puede matar request | `ingest.ts` |
| C6 | **No hay sistema de colas** | Sin queue, todo en el mismo request o cron | — |

### 15.2 Altos

| # | Problema | Impacto | Archivo |
|---|---|---|---|
| H1 | **Sin RAG** | Búsqueda en knowledge base es keyword scoring | `ai.server.ts:selectRelevantText()` |
| H2 | **Intent classifier solo regex** | No detecta intenciones complejas/ambiguas | `intent-classifier.ts` |
| H3 | **Knowledge base truncada a 4000 chars** | Conocimiento útil se pierde | `ai.server.ts` |
| H4 | **Sin memoria persistente de conversación** | Solo `focused_product_snapshot` persiste | `ai.server.ts` |
| H5 | **`processRunUntilWaitOrCompleted()` sin timeout** | Un bug en flow puede ejecutar 50 iteraciones infinitas | `flow-runner.server.ts` |
| H6 | **No hay control de concurrencia en flow trigger** | Runs duplicados posibles | `flow-trigger.server.ts` |
| H7 | **`dispatch.ts` y `flow-scheduler.ts` duplican `processDueRuns()`** | Doble ejecución de flujos | `dispatch.ts` |

### 15.3 Medios

| # | Problema | Impacto |
|---|---|---|
| M1 | Textos de abandoned orders hardcodeados | No configurables por org |
| M2 | No-response pending sin cleanup de registros viejos | Crecimiento infinito de tabla |
| M3 | Límite de 50 resultados en listado de flujos | Puede no escalar |
| M4 | Broadcast rate limit por broadcast pero no global | Múltiples broadcasts pueden saturar |
| M5 | No hay cache de productos catálogo en IA | Cada consulta viaja al modelo |
| M6 | Media resolution en commands.ts síncrona | Puede timeout si media externa es lenta |
| M7 | Fallback provider existe pero no se usa consistentemente | Sin failover real |

### 15.4 Bajos (Deuda Técnica)

| # | Problema |
|---|---|
| L1 | Nombres de funciones inconsistentes (camelCase vs snake_case) |
| L2 | Console.log scattering sin logger estructurado |
| L3 | Múltiples `as any` casts |
| L4 | Sin tipos compartidos entre frontend y backend |
| L5 | Archivos con lógica mezclada de UI y negocio |

---

## 16. Recomendaciones para FASE 2

1. **Separar ingest.ts** en módulos (contact-handler, thread-handler, ai-executor, flow-handler, order-handler)
2. **Dividir ai.server.ts** en: prompt-builder.ts, tool-executor.ts, catalog-integration.ts, knowledge-search.ts
3. **Eliminar `@ts-nocheck`** y tipar correctamente
4. **Implementar sistema de colas** (BullMQ con Redis o pg_queue)
5. **Hacer IA asíncrona** (`ASYNC_AI_REPLY=true`) con callback/webhook
6. **Implementar RAG** con pgvector (embeddings en Supabase)
7. **Agregar memoria persistente** (tabla `conversation_memory` con embeddings)
8. **Unificar cron jobs** en un solo dispatcher para evitar ejecución duplicada
9. **Agregar timeout y límites** en processRunUntilWaitOrCompleted
10. **Implementar tests** (unitarios para lógica crítica, integración para flujos)
11. **Agregar control de concurrencia** con advisory locks o unique constraints
12. **Cachear respuestas de IA** para consultas similares
13. **Hacer configurables** textos de abandoned orders
14. **Implementar rate limiting global** de broadcasts

---

*Fin del reporte FASE 1. Documentación generada el 15/06/2026 basada en análisis estático del código fuente.*
