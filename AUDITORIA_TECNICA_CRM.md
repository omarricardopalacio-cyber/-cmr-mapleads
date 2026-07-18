# AUDITORÍA TÉCNICA COMPLETA — CRM WhatsApp Engine

**Fecha:** 2026-05-30
**Arquitecto:** Análisis automático de código completo
**Proyecto:** `plan-maestro-crm` (WhatsApp CRM Engine)

---

## 1. RESUMEN EJECUTIVO

El proyecto es un **CRM conversacional omnicanal** construido sobre una arquitectura híbrida:
- **Frontend/Backend:** Aplicación web full-stack con React 19 + TanStack Start (SSR/SSG híbrido) + Vite 7.
- **Extensión Chrome:** Bridge Engine MV3 que intercepta WhatsApp Web mediante MutationObserver, inyección de scripts en `MAIN world`, y polling HTTP hacia el backend.
- **Base de datos:** Supabase PostgreSQL con RLS, realtime, y cron jobs internos.
- **IA:** Gateway dual (Lovable AI vs Vertex AI) con generación de respuestas automáticas.
- **Automatizaciones:** Auto-respuestas por reglas, mensajes programados, y campañas masivas (broadcasts) con rate-limiting.

La arquitectura es **desacoplada por diseño**: la extensión no conoce la lógica de negocio; solo envía eventos normalizados y ejecuta comandos del backend.

---

## 2. ARQUITECTURA GENERAL

### 2.1 Estructura del proyecto

```
plan-maestro-crm/
├── extension/              ← Chrome Extension Manifest V3 (bridge con WhatsApp Web)
│   ├── background/         ← Service Worker (MV3)
│   ├── content/            ← Content Scripts (ISOLATED world)
│   ├── shared/             ← Contratos y constantes (compartidos BG + CS)
│   ├── manifest.json
│   ├── popup.html / popup.js
│   └── icon.png
├── src/
│   ├── routes/             ← TanStack Router file-based routes
│   │   ├── api/public/engine/ingest.ts    ← Receptor de eventos de la extensión
│   │   ├── api/public/engine/commands.ts  ← Cola de comandos salientes
│   │   ├── api/public/cron/dispatch.ts    ← Dispatcher de programados/broadcasts
│   │   ├── _authenticated.*.tsx           ← Páginas protegidas del CRM
│   │   ├── login.tsx / signup.tsx
│   │   └── index.tsx
│   ├── components/ui/      ← shadcn/ui (44 componentes radix)
│   ├── lib/                  ← Server functions + lógica de negocio
│   ├── integrations/supabase/ ← Clientes + middleware de auth
│   ├── router.tsx
│   ├── server.ts             ← Entry point SSR con error capture
│   └── start.ts              ← Middleware global TanStack Start
├── supabase/migrations/     ← 10 migraciones SQL con esquema completo
└── vite.config.ts           ← Config TanStack Start via @lovable.dev/vite-tanstack-config
```

### 2.2 Dependencias principales

| Capa | Tecnología |
|------|-----------|
| Framework | React 19.2, TanStack Router 1.168, TanStack Start 1.167 |
| Bundler | Vite 7.3.1, @lovable.dev/vite-tanstack-config |
| Estado/Sync | TanStack Query 5.83, Supabase Realtime |
| Auth | Supabase Auth (JWT Bearer tokens) |
| DB | Supabase PostgreSQL (RLS + service_role) |
| UI | TailwindCSS 4.2.1, shadcn/ui, Radix UI, Lucide |
| Forms | React Hook Form 7.71, Zod 3.24 |
| IA | Lovable AI Gateway (Gemini/GPT) + Vertex AI (Google Cloud) |
| Charts | Recharts 2.15.4 |
| Icons | Lucide React 0.575 |

### 2.3 Servicios externos

1. **Supabase** — Auth, PostgreSQL, Realtime, Storage, Edge Functions (implícitas vía cron).
2. **Lovable AI Gateway** (`https://ai.gateway.lovable.dev/v1/chat/completions`) — Modelos Gemini/GPT.
3. **Vertex AI** (`{location}-aiplatform.googleapis.com`) — Modelos Gemini via service account JSON.
4. **WhatsApp Web** — Objetivo de la extensión Chrome (sin API oficial).

### 2.4 Flujo de ejecución

```
[Usuario abre WhatsApp Web]
        ↓
[Extensión MV3 se inyecta]
   - page-bridge.js (MAIN world) ← accede a window.Store de WA
   - content scripts (ISOLATED) ← MutationObserver + parser + sender
        ↓
[Observer detecta nuevos nodos DOM]
        ↓
[Event Bus emite → sendToBackend (chrome.runtime.sendMessage)]
        ↓
[Background SW recibe → enqueue → flush HTTP POST /api/public/engine/ingest]
        ↓
[Backend (TanStack Start server route) normaliza, guarda en DB, dispara AI/AutoReply]
        ↓
[Si hay comandos pendientes: SW hace GET /api/public/engine/commands]
        ↓
[Command Dispatcher envía SEND_MESSAGE al content script]
        ↓
[Message Sender localiza chat + inyecta texto + envía por DOM o Store API]
        ↓
[ACK vuelve por la misma ruta HTTP]
```

### 2.5 Procesos escuchando / reactivos / programados

| Proceso | Tipo | Detalle |
|---------|------|---------|
| MutationObserver | Reactivo | Escucha nuevos mensajes en el DOM de WhatsApp Web |
| `chrome.alarms` | Programado | POLL (~3s), FLUSH (~3s), HEARTBEAT (15s), HEALTH (30s) |
| pg_cron (Supabase) | Programado | Cada minuto llama a `/api/public/cron/dispatch` |
| Supabase Realtime | Reactivo | Suscripción a INSERTs en `messages` para UI de chat en vivo |
| TanStack Query polling | Programado | Refetch cada 5s en conversaciones y broadcasts |

---

## 3. MAPA COMPLETO DE COMPONENTES

### 3.1 Frontend (Pantallas y UI)

| Ruta | Archivo | Descripción |
|------|---------|-------------|
| `/` | `index.tsx` | Landing: descarga de extensión + instrucciones |
| `/login` | `login.tsx` | Formulario auth Supabase (email/password) |
| `/signup` | `signup.tsx` | Registro con display_name |
| `/dashboard` | `_authenticated.dashboard.tsx` | KPIs: contactos, conversaciones, mensajes, sesiones |
| `/conversations` | `_authenticated.conversations.tsx` | Layout split: lista de threads + panel de chat |
| `/conversations/$threadId` | `_authenticated.conversations.$threadId.tsx` | Chat individual con realtime, envío, borrado |
| `/contacts` | `_authenticated.contacts.tsx` | Tabla de contactos (wa_id, display_name, phone) |
| `/automations` | `_authenticated.automations.tsx` | Tabs: Auto-respuestas / Programados / Broadcasts |
| `/sessions` | `_authenticated.sessions.tsx` | Gestión de sesiones WA (crear, token, me_wa_id) |
| `/pipelines` | `_authenticated.pipelines.tsx` | Vista demo Kanban (4 columnas estáticas) |
| `/integrations` | `_authenticated.integrations.tsx` | Configuración IA: provider, modelo, prompt, knowledge base, test |

### 3.2 Backend (Server Functions + API Routes)

| Módulo | Archivos | Responsabilidad |
|--------|----------|-----------------|
| Auth | `auth-context.tsx`, `auth-middleware.ts`, `auth-attacher.ts` | JWT Bearer, login/logout, middleware RLS |
| CRM | `crm.functions.ts` | Dashboard stats, listar contactos y threads |
| Messaging | `messaging.functions.ts` | Listar mensajes, enviar mensaje, enviar directo, borrar chats |
| Sessions | `sessions.functions.ts` | CRUD de `wa_sessions`, token generation, me_wa_id |
| Automations | `automations.functions.ts` | Auto-replies, scheduled messages, broadcasts |
| AI | `ai.functions.ts`, `ai.server.ts` | Configuración, generación de respuestas (Lovable + Vertex) |
| Org | `org.functions.ts` | Creación automática de organización al primer login |
| Engine Ingest | `api/public/engine/ingest.ts` | **Núcleo**: recibe eventos, normaliza, persiste, dispara AI/autoreply |
| Engine Commands | `api/public/engine/commands.ts` | Entrega comandos pendientes a la extensión |
| Cron Dispatch | `api/public/cron/dispatch.ts` | Ejecuta scheduled messages y broadcasts cada minuto |

### 3.3 Infraestructura (Extensión Chrome)

| Componente | Archivo | Rol |
|------------|---------|-----|
| Service Worker | `background/index.js` | Bootstrap, alarms, message routing |
| Bridge Client | `background/bridge-client.js` | HTTP client: POST ingest, GET commands, outbox con retry |
| Command Dispatcher | `background/command-dispatcher.js` | Envía comandos al content script de la pestaña WA |
| Alarms Manager | `background/alarms.js` | Registro de handlers de `chrome.alarms` |
| Event Bus | `content/core/event-bus.js` | Pub/sub in-page + puente a background |
| Selector Engine | `content/core/selector-engine.js` | Registro central de selectores DOM con fallback |
| Message Detector | `content/core/message-detector.js` | Determina dirección in/out por 5 estrategias |
| Message Parser | `content/core/message-parser.js` | Nodo DOM → JSON normalizado |
| Observer Manager | `content/core/observer-manager.js` | MutationObserver con dedup TTL (120s) y recovery |
| Message Sender | `content/core/message-sender.js` | Pipeline de envío: Store API → DOM injection → click/Enter |
| Page Bridge | `content/bridge/page-bridge.js` | Corre en MAIN world: accede a `window.Store` de WA Web |
| Bridge Handler | `content/bridge/bridge.js` | Recibe SEND_MESSAGE y HEALTH_PING del background |
| IndexedDB | `content/storage/idb.js` | Wrapper mínimo (dedup + queue) — **actualmente sin uso activo** |
| Popup | `popup.html / popup.js` | Configuración de backendUrl + sessionToken |

---

## 4. SISTEMA DE MENSAJERÍA

### 4.1 Recepción de mensajes

**Estrategia principal:** `MutationObserver` sobre el panel de mensajes de WhatsApp Web.

```
WhatsApp Web renderiza nuevo mensaje
        ↓
MutationObserver (observer-manager.js) detecta addedNode
        ↓
message-detector.js: direction() evalúa 5 estrategias:
   1. data-id (true_ / false_)
   2. Clases CSS (message-out / message-in)
   3. Checkmarks de envío
   4. data-testid (msg-container-own / foreign)
   5. Alineación CSS (flex-end)
        ↓
message-parser.js: parseMessageNode() extrae:
   - id (data-id)
   - chatId (header data-id o location.hash)
   - direction
   - text (span.selectable-text)
   - timestamp (data-pre-plain-text)
   - media flags (image, audio, video)
        ↓
Event Bus emite "message-in" o "message-out"
        ↓
sendToBackend() → chrome.runtime.sendMessage
```

**Archivos clave:**
- `extension/content/core/observer-manager.js:47-67` (attach)
- `extension/content/core/message-detector.js:3-33` (direction)
- `extension/content/core/message-parser.js:10-34` (parse)

### 4.2 Procesamiento (Backend)

**Entrada:** `POST /api/public/engine/ingest`

```
1. Validar X-Session-Token contra wa_sessions
2. Normalizar cada evento (normalizeEvent()):
   - TYPE_MAP unifica nombres alternativos
   - Extrae chatId, waMessageId, direction, text, contact
   - Resuelve LID messages buscando phone en historial de comandos
3. Upsert contacto (org_id + wa_id)
4. Upsert thread (session_id + contact_id)
5. Insertar mensaje en messages
6. Si es message-in + tiene texto:
   a) maybeAutoReply() → busca reglas en auto_replies → inserta engine_commands
   b) maybeAiReply() → si enabled + condiciones → genera reply → inserta engine_commands
7. Si es ack + commandId → actualiza engine_commands status='acked'
```

**Archivos clave:**
- `src/routes/api/public/engine/ingest.ts:110-182` (normalizeEvent)
- `src/routes/api/public/engine/ingest.ts:189-227` (maybeAutoReply)
- `src/routes/api/public/engine/ingest.ts:272-325` (maybeAiReply)

### 4.3 Envío de mensajes

**Pipeline dual en la extensión:**

```
Backend entrega comando SEND_MESSAGE
        ↓
background/command-dispatcher.js → tabs.sendMessage()
        ↓
content/bridge/bridge.js recibe SEND_MESSAGE
        ↓
message-sender.js::sendMessage()
   ├─→ Intenta trySendViaStore() (MAIN world postMessage)
   │      page-bridge.js: trySendViaStore() → window.Store.Chat.sendMessage()
   ├─→ Fallback: openChat(chatId) → locate composer → injectText → clickSend / pressEnter
   │      openChat usa: sidebar click → URL redirect (/send?phone=) → wait
   └─→ Verifica composer cleared
        ↓
Envía ACK al background → enqueue en outbox → flush HTTP
```

**No soporta envío de multimedia** (imágenes, videos, audios, documentos) desde el backend. La extensión detecta flags de media en recepción pero no puede enviarlas.

**Archivos clave:**
- `extension/content/core/message-sender.js:188-224` (sendMessage)
- `extension/content/bridge/page-bridge.js:187-207` (trySendViaStore)

---

## 5. SISTEMA DE CONTACTOS

### 5.1 Estructura actual

Tabla `contacts` (Supabase):

```sql
id          UUID PRIMARY KEY
org_id      UUID → organizations
wa_id       TEXT NOT NULL (ej: "5215512345678@c.us" o "123456789@lid")
display_name TEXT
phone       TEXT (solo dígitos, sin @)
created_at  TIMESTAMPTZ
updated_at  TIMESTAMPTZ
UNIQUE (org_id, wa_id)
```

### 5.2 Flujo de actualización

1. **Creación:** Ocurre en `ingest.ts` cuando llega un mensaje de un `wa_id` desconocido para la org.
2. **Actualización de phone:** Si el mensaje es de tipo LID (@lid) y no hay phone, se intenta resolver buscando en `engine_commands` enviados recientes con el mismo texto (dentro de 30 min).
3. **Actualización de display_name:** Se actualiza si es NULL, vacío, "unknown", o si cambia el wa_id.
4. **Trigger:** `contacts_touch` actualiza `updated_at` automáticamente.

**No hay sistema de etiquetas en contactos.** No existe tabla de tags.

---

## 6. SISTEMA DE ETIQUETAS

### 6.1 Estado actual

**NO EXISTE un sistema de etiquetas.** No hay tabla `tags`, `contact_tags`, ni campo `tags` en contacts.

### 6.2 Impacto

- No hay categorización de contactos.
- No hay segmentación para broadcasts basada en etiquetas.
- No hay triggers basados en etiquetas.
- Las auto-respuestas operan únicamente por matching de texto del mensaje, no por etiqueta del contacto.

---

## 7. SISTEMA CRM

### 7.1 Estructura CRM

El concepto de "CRM" en este proyecto se reduce a:
- **Organización** (`organizations`): workspace multi-tenant.
- **Contactos** (`contacts`): personas con WhatsApp.
- **Threads** (`threads`): conversaciones 1-a-1 entre una sesión WA y un contacto.
- **Mensajes** (`messages`): historial completo.

**No hay:**
- Estados de oportunidad/lead
- Pipeline funcional (es una vista demo estática)
- Campos personalizados en contactos
- Notas o actividades

### 7.2 Estados disponibles

Los únicos estados con lógica son:
- `wa_sessions.status`: `pending | connected | disconnected | error`
- `engine_commands.status`: `pending | delivered | acked | failed`
- `broadcasts.status`: `draft | scheduled | running | done | cancelled`
- `scheduled_messages.status`: `pending | sent | failed | cancelled`
- `auto_replies.is_active`: boolean

---

## 8. SISTEMA IA

### 8.1 Activación

La IA se activa **automáticamente** en `maybeAiReply()` dentro de `ingest.ts` cuando:
1. Existe configuración en `ai_configs` para la org.
2. `ai_configs.enabled = true`.
3. El mensaje entrante tiene texto (`message-in`).
4. Condición `respond_to`:
   - `"all"`: responde a todos los mensajes entrantes.
   - `"new"`: solo si NO hay mensajes `out` previos en el thread (count == 0).

### 8.2 Contexto enviado a la IA

```typescript
// Construcción del prompt (ai.server.ts:111-121)
const system = [
  cfg.system_prompt,                    // Personalidad + instrucciones
  cfg.knowledge_base                    // Productos, FAQ, precios
].join("");

const messages = [
  { role: "system", content: system },
  ...history,                           // Últimos 10 mensajes del thread (excluyendo el actual)
  { role: "user", content: userText }   // Mensaje actual del cliente
];
```

**No recibe:** etiquetas, estado CRM, nombre del contacto explícito, variables dinámicas del contacto.

### 8.3 Consumo y proveedores

| Provider | Endpoint | Auth | Modelos disponibles |
|----------|----------|------|---------------------|
| Lovable | `https://ai.gateway.lovable.dev/v1/chat/completions` | `LOVABLE_API_KEY` | Gemini 2.5 Flash/Pro/Lite, GPT-5 mini/5 |
| Vertex | `{location}-aiplatform.googleapis.com/v1/projects/.../models/{model}:generateContent` | Service Account JSON (JWT OAuth2) | Gemini 2.5 Flash/Pro, 2.0, 1.5 |

**No hay contador de tokens ni rate limiting interno.** El único límite es el de la API externa.

### 8.4 Flujo completo IA

```
Cliente escribe mensaje en WhatsApp
        ↓
Extensión detecta → envía a /ingest
        ↓
Backend: maybeAiReply()
   - Consulta ai_configs
   - Verifica respond_to condition
   - Obtiene últimos 10 mensajes del thread
   - Construye messages[] con system + history + user
   - Llama generateReply() → callLovableAI() o callVertexAI()
        ↓
Backend recibe reply.trim()
        ↓
Inserta engine_commands { type: "send_message", payload: { chatId, text: reply } }
        ↓
Extensión hace poll GET /commands → recibe comando
        ↓
Message Sender ejecuta envío por WhatsApp Web
```

---

## 9. SISTEMA DE ALMACENAMIENTO

| Tecnología | Qué guarda | Ubicación |
|------------|-----------|-----------|
| **Supabase PostgreSQL** | Todo el estado de negocio: orgs, users, contacts, threads, messages, sessions, commands, events, auto_replies, scheduled, broadcasts, ai_configs | Cloud |
| **chrome.storage.local** | Configuración de la extensión: `backendUrl`, `sessionToken`, `wsStatus`, `lastError`, `lastFlush`, `lastPoll` | Navegador (extensión) |
| **IndexedDB** (`engine`) | Object stores `dedup` y `queue` — **definido pero no utilizado activamente** | Navegador (content script) |
| **LocalStorage** | Token de sesión Supabase (auth) | Navegador (app web) |
| **Memory (Map)** | Deduplicación de mensajes vistos (`SEEN` Map en observer-manager.js) | RAM content script |

---

## 10. BASE DE DATOS LÓGICA

### Modelo Entidad-Relación

```
organizations (1)
    ├── (*) contacts
    ├── (*) wa_sessions
    ├── (*) threads
    ├── (*) messages
    ├── (*) engine_commands
    ├── (*) events
    ├── (*) auto_replies
    ├── (*) scheduled_messages
    ├── (*) broadcasts
    │       └── (*) broadcast_recipients
    ├── (1) ai_configs
    └── (*) user_roles

contacts (1) ←── (*) threads
wa_sessions (1) ←── (*) threads
threads (1) ←── (*) messages

auth.users (1) ←── (1) profiles
auth.users (1) ←── (*) user_roles → organizations
```

### Entidades detalladas

| Entidad | Campos clave | Relaciones |
|---------|-------------|------------|
| `organizations` | id, name, created_by | Padre de todo |
| `profiles` | id, display_name, avatar_url | 1:1 con auth.users |
| `user_roles` | user_id, org_id, role | N:M users-orgs |
| `wa_sessions` | id, org_id, label, session_token, status, me_wa_id | Genera threads y commands |
| `contacts` | id, org_id, wa_id, display_name, phone | Tiene threads |
| `threads` | id, org_id, session_id, contact_id, last_message_at, unread_count | Contiene messages |
| `messages` | id, org_id, thread_id, wa_message_id, direction, text, media, raw, sent_at | Hija de threads |
| `engine_commands` | id, org_id, session_id, type, payload, status, ack, attempts, delivered_at, acked_at | Cola de trabajo para extensión |
| `events` | id, org_id, session_id, type, payload, created_at | Log de eventos crudo |
| `auto_replies` | id, org_id, session_id, name, match_type, match_value, reply_text, is_active, cooldown_seconds, last_triggered_at | Reglas de auto-respuesta |
| `scheduled_messages` | id, org_id, session_id, wa_id, text, send_at, status, command_id | Mensajes programados |
| `broadcasts` | id, org_id, session_id, name, message_text, status, rate_per_minute, total_count, sent_count, failed_count, scheduled_at | Campañas masivas |
| `broadcast_recipients` | id, broadcast_id, org_id, wa_id, status, command_id, sent_at | Destinatarios de broadcast |
| `ai_configs` | org_id, enabled, provider, model, system_prompt, knowledge_base, respond_to, vertex_project, vertex_location, vertex_model | Config IA por org |

---

## 11. EVENTOS DEL SISTEMA

| Evento | Origen | Consumidores |
|--------|--------|------------|
| `message-in` | Extensión → ingest.ts | DB (contacts, threads, messages), maybeAutoReply, maybeAiReply, Supabase Realtime (UI) |
| `message-out` | Extensión → ingest.ts | DB (messages), UI realtime |
| `heartbeat` | Extensión (alarms) → ingest.ts | Actualiza wa_sessions.status = 'connected', last_heartbeat_at |
| `status` | Extensión (observer attach) | events (log) |
| `ack` | Extensión (post-send) → ingest.ts | Actualiza engine_commands.status = 'acked' |
| `SEND_MESSAGE` | Backend (commands.ts) → Extensión | Message Sender ejecuta envío físico |
| `HEALTH_PING` | Background (alarms) → Content Script | Observer ensure() (reattach si es necesario) |
| `INSERT messages` | Supabase DB | Frontend suscripto via Realtime (invalida query) |
| `cron.dispatch` | pg_cron (Supabase) | Ejecuta scheduled_messages + broadcasts |

---

## 12. AUTOMATIZACIONES EXISTENTES

### 12.1 Auto-respuestas (`auto_replies`)

- **Disparador:** Texto del mensaje entrante.
- **Matching:** `contains`, `equals`, `starts`, `regex`.
- **Cooldown:** Por regla (`cooldown_seconds`), con `last_triggered_at`.
- **Scope:** Por org, opcionalmente filtrado por `session_id`.
- **Acción:** Inserta `engine_commands` tipo `send_message`.

### 12.2 Mensajes programados (`scheduled_messages`)

- **Disparador:** Horario (`send_at <= now()`).
- **Ejecutor:** `/api/public/cron/dispatch` cada minuto (pg_cron).
- **Estados:** `pending → sent | failed | cancelled`.

### 12.3 Broadcasts (campañas masivas)

- **Disparador:** Inmediato o programado (`scheduled_at`).
- **Rate limiting:** `rate_per_minute` (máx 60/min).
- **Ejecutor:** Mismo cron dispatch.
- **Tracking:** `sent_count / total_count` con progress bar en UI.
- **Destinatarios:** Lista de `wa_id` en `broadcast_recipients`.

### 12.4 Respuestas IA

- **Disparador:** Todo mensaje entrante (si `enabled` y `respond_to` satisface).
- **Contexto:** Últimos 10 mensajes + system prompt + knowledge base.
- **Acción:** Genera texto y encola `engine_commands`.

---

## 13. PUNTOS DE EXTENSIÓN (Integración segura)

### 13.1 Nuevo módulo de Auto Respuestas Avanzadas

**Punto de inserción:** `ingest.ts:454-463` (justo después de `maybeAutoReply` y `maybeAiReply`).

**Ventaja:** El evento ya está normalizado, contacto/thread creados, y se conoce el `orgId`, `sessionId`, `chatId`, `text`.

**Riesgo:** Bajo. Es un nuevo `maybeXReply()` que inserta en `engine_commands`.

### 13.2 Nuevo módulo de Flujos (Flow Builder)

**Punto de inserción:**
1. DB: Nueva tabla `flows` + `flow_steps` + `flow_executions`.
2. Backend: Nuevo `maybeFlowTrigger()` en `ingest.ts` después de auto-reply.
3. UI: Nueva ruta `/flows` bajo `_authenticated`.

**Ventaja:** Se puede reutilizar el mismo patrón de `engine_commands` como acciones de salida.

### 13.3 Nuevo módulo de Estados WhatsApp

**Punto de inserción:** Ampliar `message-detector.js` para observar cambios de estado (delivered, read, failed) en los checkmarks del DOM. Emitir nuevo evento `message-status-changed`.

**Backend:** Nuevo campo `messages.wa_status` + handler en `ingest.ts`.

### 13.4 Nuevo módulo de Campañas

**Ya existe** (`broadcasts`). Para enriquecerlo:
- Segmentación por contactos/etiquetas (requiere crear tags primero).
- Templates con variables.
- Botones de respuesta rápida.

### 13.5 Nuevo módulo de IA Híbrida

**Punto de inserción:** `ai.server.ts:generateReply()`.

**Mejoras posibles sin romper nada:**
- Añadir RAG (vector search en knowledge base).
- Añadir function calling (herramientas: buscar pedido, crear ticket).
- Multi-agent routing según intención del mensaje.

### 13.6 Nuevo módulo de Automatizaciones

**Punto de inserción:** El cron `dispatch.ts` ya es un scheduler general. Se pueden añadir:
- Nuevas tablas de automatización.
- Nuevos bloques en el handler del cron.

---

## 14. DEPENDENCIAS ENTRE MÓDULOS

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Chrome Ext    │────→│  Engine API     │────→│   Supabase DB   │
│  (Observer)     │←────│ (ingest/cmds)   │←────│  (PostgreSQL)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         ↑                       ↑                       ↑
         │                       │                       │
   page-bridge.js         TanStack Start           TanStack Query
   (MAIN world)           (SSR/Server Fn)         (Frontend cache)
```

| Módulo | Depende de | Utiliza | Impacto si falla |
|--------|-----------|---------|-----------------|
| Extensión | WhatsApp Web DOM | Selector Engine, Store API | Toda la mensajería se detiene |
| Engine Ingest | Supabase, Extensión | Zod, normalizeEvent | Pérdida de mensajes, no se guardan |
| Engine Commands | Supabase, Extensión | Polling del SW | No se envían mensajes salientes |
| AI Reply | Lovable/Vertex API | ai.server.ts | Las respuestas IA fallan silenciosamente (try/catch) |
| Auto Reply | Supabase (auto_replies) | String matching | No responde a triggers |
| Cron Dispatch | Supabase pg_cron, API endpoint | scheduled_messages, broadcasts | No se envían programados ni campañas |
| Frontend CRM | Supabase Auth, Server Fn | TanStack Query, Realtime | Usuario no ve datos |

---

## 15. RIESGOS DE IMPLEMENTACIÓN

### 15.1 Código duplicado

- **`getUserOrg()`** está duplicada en 6 archivos (`crm.functions.ts`, `messaging.functions.ts`, `sessions.functions.ts`, `automations.functions.ts`, `ai.functions.ts`, `org.functions.ts`).
- **CORS headers** duplicados en `ingest.ts` y `commands.ts`.

### 15.2 Acoplamiento fuerte

- `ingest.ts` es una función gigante (481 líneas) que hace: validación, normalización, persistencia, auto-reply, IA reply, acks, resolución de LID. Es el **corazón monolítico** del sistema.
- Si falla una parte (ej: IA timeout), el resto del procesamiento del batch podría verse afectado si no se maneja bien.

### 15.3 Funciones gigantes

- `normalizeEvent()`: ~73 líneas de lógica compleja de parsing.
- `ingest.ts POST handler`: ~140 líneas de procesamiento secuencial.
- `page-bridge.js`: 386 líneas con múltiples responsabilidades (Store hacking, DOM manipulation, chat resolution).

### 15.4 Cuellos de botella

1. **Polling HTTP**: La extensión hace GET cada ~3s por sesión. Con muchas sesiones activas, esto genera muchas queries a `engine_commands`.
2. **Realtime por thread**: Cada chat abierto en el frontend crea un canal Realtime de Supabase. Con muchos usuarios concurrentes, puede saturar conexiones.
3. **IA síncrona**: `maybeAiReply()` espera respuesta de la IA antes de continuar. Si tarda 5s, el request de ingest se retrasa.
4. **Broadcasts sin concurrencia**: El cron corre secuencialmente. Con miles de destinatarios, puede tardar minutos.

### 15.5 Riesgos al modificar

- **Cambiar selectores de WA**: Solo `selector-engine.js` centraliza selectores, pero `page-bridge.js` tiene selectores hardcodeados (`querySelector` directo).
- **Cambiar estructura de eventos**: Afecta `contracts.js`, `normalizeEvent()`, y toda la extensión.
- **Modificar RLS**: 16 tablas con RLS; un error en `is_member()` o `has_role()` expone datos.
- **Whatsapp Web Store API**: Es ingeniería inversa. WhatsApp puede cambiar webpack chunks en cualquier momento y romper `page-bridge.js`.

---

## 16. PROPUESTA DE ARQUITECTURA FUTURA

### 16.1 Etiquetas inteligentes

```sql
CREATE TABLE tags (id, org_id, name, color, auto_rules);
CREATE TABLE contact_tags (contact_id, tag_id);
```
- Integrar en `ingest.ts` después de crear/actualizar contacto.
- UI en `/contacts` para asignar/desasignar.
- Segmentación de broadcasts por tags.

### 16.2 Auto respuestas avanzadas

- Añadir condiciones: horario, tag del contacto, día de la semana.
- Añadir acciones: asignar tag, cambiar pipeline stage, enviar mensaje con variables.
- Tabla `automation_rules` con JSONB de condiciones y acciones.

### 16.3 Flujos (Flow Builder)

- Tablas: `flows`, `flow_nodes`, `flow_edges`, `flow_executions`.
- Motor de ejecución: serverless function o cron que procesa `flow_executions`.
- UI con react-flow o similar en nueva ruta `/flows`.

### 16.4 Estados WhatsApp

- Ampliar `message-detector.js` para detectar cambios en checkmarks (`msg-check`, `msg-dblcheck`, `msg-dblcheck-ack`).
- Nuevo evento `MESSAGE_STATUS_CHANGED` → actualiza `messages.wa_status`.

### 16.5 Campañas masivas mejoradas

- Templates con variables (`{{nombre}}`, `{{producto}}`).
- Segmentación por tags, fechas de último contacto.
- A/B testing (múltiples variantes de mensaje).
- Reporte de clics/respuestas (requiere tracking).

### 16.6 IA híbrida

- **RAG:** Vectorizar `knowledge_base` en Supabase pgvector; hacer retrieval antes de generar reply.
- **Function Calling:** Permitir a la IA llamar "tools" (buscar contacto, crear pedido, consultar stock).
- **Agente supervisor:** Clasificar intención del mensaje y enrutar al agente especializado (ventas, soporte, facturación).
- **Human handoff:** Umbral de confianza; si la IA no sabe, notificar a humano y pausar auto-reply.

### 16.7 CRM avanzado

- Pipeline funcional: tabla `pipeline_stages` + `deals` (oportunidades vinculadas a contactos).
- Notas y actividades: `activities` (calls, meetings, tasks) vinculadas a contacts.
- Campos personalizados: `contact_fields` schema dinámico por org.

---

## 17. PLAN DE IMPLEMENTACIÓN SUGERIDO

### Fase 1: Fundamentos (1-2 semanas)
1. Extraer `getUserOrg` a helper compartido (eliminar duplicación).
2. Refactor `ingest.ts`: extraer `normalizeEvent`, `maybeAutoReply`, `maybeAiReply` a archivos separados.
3. Agregar tests unitarios para `normalizeEvent` y `message-detector.js`.

### Fase 2: Etiquetas y Segmentación (2 semanas)
1. Crear tablas `tags`, `contact_tags`.
2. UI de gestión de etiquetas en contactos.
3. Ampliar broadcasts para filtrar por tags.

### Fase 3: CRM Funcional (2-3 semanas)
1. Tablas `pipeline_stages`, `deals`.
2. Convertir `/pipelines` en Kanban real (drag & drop).
3. Notas y actividades por contacto.

### Fase 4: IA Avanzada (2-3 semanas)
1. Integrar pgvector para RAG.
2. Implementar function calling básico.
3. Human handoff con notificaciones (Supabase Realtime o email).

### Fase 5: Flujos y Automatizaciones (3-4 semanas)
1. Motor de flujos con tabla `flow_executions`.
2. UI visual de flow builder.
3. Reemplazar auto_replies simples por nodos de flujo.

### Fase 6: Escalabilidad (continuo)
1. Migrar polling de extensión a WebSocket real (Supabase Realtime o Socket.io).
2. Cola de trabajo para broadcasts (Redis/Bull o Supabase Queues).
3. Rate limiting por org en ingest.

---

## ANEXO A: Archivos críticos del sistema

| Ruta | Líneas | Rol |
|------|--------|-----|
| `extension/content/bridge/page-bridge.js` | 386 | Acceso a WhatsApp Store API |
| `extension/content/core/message-sender.js` | 228 | Envío físico de mensajes |
| `extension/content/core/observer-manager.js` | 91 | Detección de mensajes nuevos |
| `extension/background/bridge-client.js` | 68 | HTTP client hacia backend |
| `src/routes/api/public/engine/ingest.ts` | 481 | Núcleo de procesamiento de mensajes |
| `src/routes/api/public/cron/dispatch.ts` | 134 | Scheduler de campañas y programados |
| `src/lib/ai.server.ts` | 134 | Generación de respuestas IA |
| `src/lib/messaging.functions.ts` | 196 | API de mensajería del frontend |
| `supabase/migrations/20260528203148_*.sql` | 222 | Esquema base completo |
| `supabase/migrations/20260528211021_*.sql` | 93 | Automatizaciones y broadcast |

---

*Fin del informe técnico.*
