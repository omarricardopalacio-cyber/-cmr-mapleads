# AUDITORÍA TÉCNICA COMPLETA — MAPLE WA ENGINE

**Fecha:** 2026-05-30
**Arquitecto:** Análisis automático de código completo
**Proyecto:** `maple-wa-engine` (WhatsApp Web Bridge Engine)

---

## 1. RESUMEN EJECUTIVO

El proyecto es un **bridge engine** de WhatsApp Web puro: una extensión Chrome Manifest V3 que conecta WhatsApp Web con cualquier CRM cloud externo. **No es un CRM completo**, sino el puente de mensajería. Incluye:

- **Extensión Chrome MV3** profesional con arquitectura de 3 capas (Injected → Content → Background).
- **Detección dual**: Usa WA-JS/WPPConnect como motor principal y MutationObserver como fallback robusto.
- **Envío robusto**: Cola interna con rate limiting (30 msg/min), retry (3 intentos), timeout (30s) y AbortController.
- **Módulo UI opcional**: Panel de conversaciones tipo WhatsApp Web (React) para integrar en cualquier frontend.
- **Sincronización**: Polling HTTP cada 3s hacia backend externo + batch ingest cada 5s.
- **Multi-sesión**: Soporte para múltiples perfiles Chrome con identificación por `sessionId`.

**A diferencia del CRM anterior (`plan-maestro-crm`), este proyecto NO tiene backend propio, NO tiene base de datos propia y NO tiene lógica CRM.** Es un componente reutilizable de infraestructura.

---

## 2. ARQUITECTURA GENERAL

### 2.1 Estructura del proyecto

```
maple-wa-engine/
├── extension/              ← Chrome Extension Manifest V3 (100% del motor)
│   ├── manifest.json
│   ├── background/
│   │   └── service-worker.ts     ← Service Worker MV3
│   ├── content/
│   │   ├── index.ts               ← Inyección de scripts en MAIN world
│   │   ├── bridge-listener.ts     ← Reenvío injected → background
│   │   └── dom-detector.ts        ← Fallback MutationObserver (321 líneas)
│   ├── injected/
│   │   ├── whatsapp-engine.ts     ← Entry point del script inyectado
│   │   ├── wpp-bootstrap.ts       ← waitForWPP() con retry
│   │   ├── event-engine.ts        ← Listeners WPP (new_message, active_chat, etc)
│   │   ├── chat-detector.ts       ← getActiveChat, getChatList, findChat
│   │   ├── contact-detector.ts    ← getContactList, getProfilePicture, getLabels
│   │   ├── message-detector.ts    ← getMessageById, ack subscription (polling)
│   │   └── sender-engine.ts       ← Cola de envío con retry + rate limit
│   ├── bridge/
│   │   ├── bridge.ts              ← ContentBridge + BackgroundBridge
│   │   ├── event-bus.ts           ← Bus de eventos tipado con historial
│   │   └── postmessage.ts         ← postMessage helpers + chrome.runtime.sendMessage
│   ├── api/
│   │   ├── backend-client.ts    ← HTTP client genérico
│   │   ├── polling.ts             ← Polling service de comandos
│   │   └── ingest.ts              ← Batch ingest service
│   ├── storage/
│   │   └── db.ts                  ← Dexie DB (events, commands, messages, cache)
│   ├── popup/
│   │   ├── App.tsx                ← Popup UI React (5 tabs)
│   │   ├── components/
│   │   │   ├── StatusPanel.tsx    ← Estado WPP/Sesión/Backend/Cola
│   │   │   ├── ConfigPanel.tsx    ← Backend URL + Session Token
│   │   │   ├── SessionList.tsx    ← Sesiones activas
│   │   │   ├── QueueStatus.tsx    ← Tamaño de cola
│   │   │   └── DebugPanel.tsx     ← Logs y comandos manuales
│   │   ├── main.tsx
│   │   └── index.html
│   ├── shared/
│   │   ├── types.ts               ← Interfaces TypeScript completas
│   │   └── contracts.ts           ← Constantes, endpoints, topics
│   ├── public/vendor/
│   │   └── wppconnect-wa.min.js   ← WA-JS inyectado localmente (NO CDN)
│   ├── build.js                   ← Build script personalizado
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
├── web/
│   └── conversations/             ← Módulo UI opcional para CRM externo
│       ├── components/
│       ├── hooks/
│       ├── types.ts
│       ├── index.ts
│       └── README.md
└── docs/
    ├── ARCHITECTURE.md
    ├── BACKEND_PROTOCOL.md
    ├── MESSAGE_FLOW.md
    ├── MULTISESSION.md
    └── DEBUGGING.md
```

### 2.2 Dependencias principales

| Capa | Tecnología |
|------|-----------|
| Framework Popup | React 18.3.1 + Vite 5.3.1 |
| Bundler | Vite 5.3.1 + build.js personalizado |
| Extensión | Chrome Manifest V3 |
| WhatsApp Engine | WA-JS / WPPConnect (wppconnect-wa.min.js) |
| Storage | IndexedDB + Dexie 4.0.8 |
| Estilos Popup | TailwindCSS 3.4.4 |
| Types | TypeScript 5.5.2 |
| Runtime Chrome | @types/chrome 0.0.268 |

### 2.3 Servicios externos

1. **WhatsApp Web** (`https://web.whatsapp.com`) — Objetivo de la extensión.
2. **Backend CRM externo** — REST API configurable por el usuario (URL + token). Endpoints esperados:
   - `GET /api/public/engine/commands`
   - `POST /api/public/engine/ingest`
   - `POST /api/public/engine/heartbeat`

**No hay backend embebido.** La extensión es agnóstica del CRM.

### 2.4 Flujo de ejecución

```
[Usuario abre WhatsApp Web en Chrome con extensión instalada]
        ↓
[Content Script se inyecta en document_idle]
   ├─ Inyecta wppconnect-wa.min.js en MAIN world
   ├─ Espera 5s
   ├─ Inyecta whatsapp-engine.js en MAIN world
   └─ Inicia DOM Detector (fallback)
        ↓
[Injected Script (MAIN world)]
   ├─ waitForWPP() → espera window.WPP (30s timeout)
   ├─ initEventEngine() → registra listeners WPP
   ├─ senderEngine listo
   └─ Emite SESSION_READY
        ↓
[Evento via postMessage → Content Script → Background SW]
        ↓
[Background SW]
   ├─ Recibe evento → guarda en chrome.storage.local "eventQueue"
   ├─ Alarm "flush_ingest" cada 5s → POST /api/public/engine/ingest
   ├─ Alarm "polling" cada 3s → GET /api/public/engine/commands
   ├─ Alarm "heartbeat" cada 15s → POST /heartbeat
   └─ Alarm "cleanup" cada 5min
        ↓
[Backend CRM procesa → responde comandos]
        ↓
[Background SW recibe comandos → chrome.tabs.sendMessage]
        ↓
[Content Script → ContentBridge.sendToInjected()]
        ↓
[Injected Script ejecuta comando (ej: SEND_MESSAGE)]
        ↓
[senderEngine.processQueue() → WPP.chat.sendTextMessage()]
        ↓
[WhatsApp Web envía mensaje físico]
        ↓
[WA-JS emite chat.new_message (fromMe=true)]
        ↓
[Evento MESSAGE_SENT → ingest → backend]
```

### 2.5 Procesos escuchando / reactivos / programados

| Proceso | Tipo | Detalle |
|---------|------|---------|
| `WPP.prependListener("chat.new_message")` | Reactivo | Evento nativo de WA-JS cuando llega/envía mensaje |
| `WPP.on("chat.active_chat")` | Reactivo | Cambio de chat activo |
| `WPP.on("chat.presence_change")` | Reactivo | Cambio de presencia (online/typing/recording) |
| `WPP.on("chat.update_label")` | Reactivo | Etiquetas de chat actualizadas |
| `WPP.on("conn.stream_info_changed")` | Reactivo | Cambio de estado de conexión WA |
| `MutationObserver` (dom-detector.ts) | Reactivo | Fallback cuando WPP falla; escanea DOM cada 5s |
| `chrome.alarms` — polling | Programado | Cada 3 segundos: GET /commands |
| `chrome.alarms` — heartbeat | Programado | Cada 15 segundos: POST /heartbeat |
| `chrome.alarms` — flush_ingest | Programado | Cada 5 segundos: POST batch events |
| `chrome.alarms` — cleanup | Programado | Cada 5 minutos: limpieza de datos antiguos |
| `subscribeToAck` (message-detector.ts) | Programado | Polling cada 500ms para acks de mensajes |
| `senderEngine.processQueue()` | Programado | Procesa cola de envío secuencialmente |

---

## 3. MAPA COMPLETO DE COMPONENTES

### 3.1 Extensión Chrome (Motor)

| Componente | Archivo | Rol | Líneas |
|------------|---------|-----|--------|
| **Service Worker** | `background/service-worker.ts` | Coordina tabs, backend API, alarms, cola de eventos | 422 |
| **Content Script** | `content/index.ts` | Inyecta WA-JS + engine; inicializa bridge + DOM detector | 68 |
| **Content Bridge** | `bridge/bridge.ts` | Clases ContentBridge + BackgroundBridge; orquesta comunicación | 220 |
| **Event Bus** | `bridge/event-bus.ts` | Pub/sub tipado con historial (max 50) | 88 |
| **PostMessage** | `bridge/postmessage.ts` | Helpers postMessage entre injected↔content + chrome.runtime | 98 |
| **DOM Detector** | `content/dom-detector.ts` | MutationObserver fallback + scanAll agresivo | 321 |
| **WhatsApp Engine** | `injected/whatsapp-engine.ts` | Entry point injected; handleCommands router | 149 |
| **WPP Bootstrap** | `injected/wpp-bootstrap.ts` | waitForWPP() con timeout 30s, retry 100ms | 70 |
| **Event Engine** | `injected/event-engine.ts` | Registra 5 listeners WPP + normalizadores | 210 |
| **Sender Engine** | `injected/sender-engine.ts` | Cola de envío con rate limit, retry, timeout, AbortController | 221 |
| **Chat Detector** | `injected/chat-detector.ts` | getActiveChat, getChatList, findChat, getChatMessages | 100 |
| **Contact Detector** | `injected/contact-detector.ts` | getContactList, getContact, getProfilePicture, getLabels | 72 |
| **Message Detector** | `injected/message-detector.ts` | getMessageById, deleteMessage, subscribeToAck (polling 500ms) | 63 |
| **Bridge Listener** | `content/bridge-listener.ts` | Helper de reenvío injected → background | 36 |
| **Dexie DB** | `storage/db.ts` | IndexedDB: events, pendingCommands, pendingMessages, contacts, chats, sessions, cache | 222 |
| **Types** | `shared/types.ts` | Interfaces TypeScript completas (WAMessage, WAChat, WAContact, etc) | 176 |
| **Contracts** | `shared/contracts.ts` | Constantes, endpoints, topics, timeouts | 63 |

### 3.2 Popup UI (Panel de configuración)

| Componente | Archivo | Rol |
|------------|---------|-----|
| App | `popup/App.tsx` | Layout principal con 5 tabs |
| StatusPanel | `popup/components/StatusPanel.tsx` | Indicadores WPP/Sesión/Backend, queue size, latency |
| ConfigPanel | `popup/components/ConfigPanel.tsx` | Backend URL + Session Token |
| SessionList | `popup/components/SessionList.tsx` | Lista de sesiones activas |
| QueueStatus | `popup/components/QueueStatus.tsx` | Estado de la cola de eventos |
| DebugPanel | `popup/components/DebugPanel.tsx` | Logs y comandos manuales |

### 3.3 Módulo Web (Conversaciones para CRM externo)

| Componente | Ubicación | Rol |
|------------|-----------|-----|
| ConversationsPanel | `web/conversations/components/` | Layout split tipo WhatsApp Web |
| ChatList | `web/conversations/components/` | Sidebar de chats con búsqueda |
| ChatMessages | `web/conversations/components/` | Panel de burbujas de mensajes |
| ChatInput | `web/conversations/components/` | Barra de input + envío |
| NewConversationModal | `web/conversations/components/` | Modal para nuevo chat |
| useConversations | `web/conversations/hooks/` | Hook de estado (actualmente usa localStorage) |

**Nota:** El módulo `web/conversations/` es un **kit de UI reutilizable**, no tiene backend real conectado. El README indica que el desarrollador debe implementar el polling/WebSocket contra su propio backend.

---

## 4. SISTEMA DE MENSAJERÍA

### 4.1 Recepción de mensajes (Dual Strategy)

#### Estrategia A: WA-JS (Principal)

```
WhatsApp WebSocket recibe mensaje
        ↓
Store.Msg.add() interceptado por WA-JS
        ↓
WPP.prependListener("chat.new_message", handler)
        ↓
event-engine.ts: normalizeMessage()
   - Extrae: messageId, chatId, from, to, body, type, timestamp, fromMe, author, media, ack
        ↓
postFromInjected("WA_EVENT", { event: "NEW_MESSAGE", payload: normalized })
        ↓
window.postMessage → Content Script
        ↓
ContentBridge.handleInjectedMessage()
        ↓
sendToBackground("WA_EVENT") → chrome.runtime.sendMessage
        ↓
BackgroundBridge.handleContentMessage()
        ↓
Guarda en chrome.storage.local "eventQueue"
```

#### Estrategia B: DOM Detector (Fallback)

```
WhatsApp Web renderiza mensaje en DOM
        ↓
MutationObserver (dom-detector.ts:244) detecta addedNodes
        ↓
scanAll() → busca TODOS los elementos con data-id="true_*" o data-id="false_*"
        ↓
direction(node) evalúa 7 estrategias:
   1. data-id prefix (true_/false_)
   2. Clases CSS (message-out / message-in)
   3. Descendientes con esas clases
   4. Iconos de check (data-icon="check")
   5. data-testid (own/foreign)
   6. Estilo CSS (alignSelf/justifyContent flex-end)
   7. Default: "in"
        ↓
parseMessageNode() extrae: id, chatId, direction, text, timestamp_label, media flags
        ↓
sendToBackground("WA_EVENT") directo (bypass injected)
```

**Archivos clave:**
- `extension/injected/event-engine.ts:44-58` (WA-JS listener)
- `extension/content/dom-detector.ts:41-70` (direction)
- `extension/content/dom-detector.ts:117-140` (parseMessageNode)
- `extension/content/dom-detector.ts:192-225` (scanAll)

### 4.2 Procesamiento (Background)

**No hay procesamiento de negocio.** El background solo:
1. Recibe eventos del content script.
2. Los acumula en `chrome.storage.local` bajo la clave `"eventQueue"`.
3. Cada 5 segundos (alarm `flush_ingest`), toma hasta 50 eventos y los envía vía `POST /api/public/engine/ingest`.
4. Mapea tipos de evento antes de enviar (`mapEventType()`):
   - `NEW_MESSAGE` → `message-in`
   - `MESSAGE_SENT` → `message-out`
   - `MESSAGE_ACK` / `MESSAGE_FAILED` → `ack`
   - `SESSION_READY` / `SESSION_LOST` / `HEARTBEAT` → `heartbeat`
   - Otros → `status`

**Archivos clave:**
- `extension/background/service-worker.ts:253-322` (flushIngestQueue)
- `extension/background/service-worker.ts:263-273` (mapEventType)

### 4.3 Envío de mensajes

```
Backend devuelve comando SEND_MESSAGE en GET /commands
        ↓
Background SW: dispatchCommand()
   - Busca tab de WhatsApp Web correspondiente
   - chrome.tabs.sendMessage() → Content Script
        ↓
Content Script: ContentBridge.handleBackgroundMessage()
   - Reconoce channel "WA_COMMAND"
   - ContentBridge.sendToInjected(msg) con timeout 15s
        ↓
postFromContent("WA_COMMAND") → window.postMessage
        ↓
Injected Script: handleCommands() → case "SEND_MESSAGE"
        ↓
senderEngine.send({ chatId, text, media, caption, quotedMsgId })
        ↓
SenderEngine.queue.push(task)
        ↓
processQueue():
   ├─ waitForRateLimit() → max 30 msg/min
   ├─ executeTask():
   │   ├─ AbortController + timeout 30s
   │   ├─ Si media: WPP.chat.sendFileMessage()
   │   └─ Si texto: WPP.chat.sendTextMessage()
   ├─ Éxito: emitStatus("sent") → MESSAGE_SENT
   ├─ Retry (max 3, delay exponencial)
   └─ Fallo: emitStatus("failed") → MESSAGE_FAILED
```

**Archivos clave:**
- `extension/injected/sender-engine.ts:30-85` (SenderEngine class)
- `extension/injected/sender-engine.ts:94-153` (executeTask)
- `extension/injected/sender-engine.ts:156-171` (waitForRateLimit)

### 4.4 Reconocimientos (ACKs)

- **message-detector.ts**: `subscribeToAck(msgId, callback)` hace polling cada 500ms llamando `WPP.chat.getMessageById(msgId)` hasta que `ack >= 3` (read).
- **sender-engine.ts**: Emite eventos `MESSAGE_SENT` / `MESSAGE_FAILED` / `MESSAGE_ACK` vía `postFromInjected`.
- **background SW**: `sendCommandAck()` envía ACK explícito al backend como evento de ingest después de ejecutar un comando.

---

## 5. SISTEMA DE CONTACTOS

### 5.1 Estructura

Los contactos se manejan a nivel de **IndexedDB** (`db.contacts`) y se normalizan desde WPP:

```typescript
interface WAContact {
  contactId: string;      // ej: "573001234567@c.us"
  user: string;             // "573001234567"
  server: string;           // "c.us" o "g.us"
  name: string;
  displayName: string;
  pushname: string;
  verifiedName: string;
  shortName: string;
  picture: string | null;
  labels: string[];
  isBusiness: boolean;
  isGroup: boolean;
}
```

### 5.2 Operaciones disponibles

| Operación | Fuente | Método |
|-----------|--------|--------|
| Listar contactos | WPP | `WPP.contact.list()` → normalize |
| Obtener contacto | WPP | `WPP.contact.get(contactId)` |
| Foto de perfil | WPP | `WPP.contact.getProfilePictureUrl()` |
| Número de teléfono | WPP | `WPP.whatsapp.ApiContact.getPhoneNumber()` |
| Etiquetas nativas | WPP | `WPP.labels.getAllLabels()` |
| Guardar localmente | Dexie | `db.contacts.put(contact)` |

**No hay CRUD de contactos propio.** La extensión solo extrae lo que WhatsApp Web ya tiene.

---

## 6. SISTEMA DE ETIQUETAS

### 6.1 Estado actual

**Existe soporte pasivo para etiquetas nativas de WhatsApp Business:**
- `contact-detector.ts`: `getLabels()` expone las etiquetas nativas de WA.
- `chat-detector.ts`: `normalizeChat()` incluye `labels: chat.labels`.
- `event-engine.ts`: `registerLabelUpdate()` emite evento `LABEL_UPDATED` cuando cambian.

**No hay sistema de etiquetas propio.** No existe tabla de tags personalizados ni categorización del CRM.

### 6.2 Eventos de etiquetas

```typescript
// Evento emitido cuando cambian etiquetas
{
  type: "LABEL_UPDATED",
  payload: {
    chatId: "573001234567@c.us",
    labels: ["label-id-1", "label-id-2"],
    action: "add" | "remove"
  }
}
```

### 6.3 Comando de etiquetas

El backend puede enviar `UPDATE_LABEL` para modificar etiquetas nativas de un chat.

---

## 7. SISTEMA CRM

**NO EXISTE un sistema CRM en este proyecto.**

El proyecto es un bridge engine puro. No tiene:
- Tablas de oportunidades/leads
- Pipeline de ventas
- Estados de conversación
- Campos personalizados
- Notas o actividades
- Automatizaciones de negocio
- IA integrada

El módulo `web/conversations/` es un **kit de UI** que el desarrollador debe integrar en su propio CRM.

---

## 8. SISTEMA IA

**NO EXISTE un sistema de IA en este proyecto.**

La extensión no tiene:
- Generación de respuestas automáticas
- Prompts de sistema
- Knowledge base
- Integración con LLMs
- Function calling

**Cualquier funcionalidad de IA debe implementarse en el backend CRM externo.**

---

## 9. SISTEMA DE ALMACENAMIENTO

| Tecnología | Qué guarda | Ubicación |
|------------|-----------|-----------|
| **IndexedDB (Dexie)** | Events, pendingCommands, pendingMessages, contacts, chats, sessions, cache | Navegador (extensión) |
| **chrome.storage.local** | Config (backendUrl, sessionToken), eventQueue (buffer temporal), wsStatus, lastError, lastPoll, lastFlush, lastDomEvent | Navegador (SW) |
| **Memory (Map)** | SEEN (dedup de mensajes DOM, TTL 120s), activeSessions (Map<string, SessionInfo>) | RAM (SW + content) |
| **localStorage** | Datos demo del módulo `web/conversations` | Navegador (app externa) |

### Dexie Schema

```typescript
// MapleWAEngineDB v1
events: "++id, eventId, eventType, synced, timestamp"
pendingCommands: "++id, commandId, status, createdAt"
pendingMessages: "++id, messageId, chatId, status, createdAt"
contacts: "contactId, user, server, name, isGroup"
chats: "chatId, user, server, name, isGroup, unreadCount"
sessions: "sessionId, browserId, deviceId, isReady, connectedAt"
cache: "++id, key, expiresAt, createdAt"
```

**Nota:** La cola de eventos en `chrome.storage.local` (no IndexedDB) es la ruta principal de buffering. El Dexie `events` table existe pero parece no ser usado activamente por el SW (el SW usa `chrome.storage.local` para la cola).

---

## 10. BASE DE DATOS LÓGICA

**No hay base de datos propia.** El proyecto es stateless respecto al backend.

### Modelo de datos en IndexedDB (local)

```
SessionInfo (1)
    └── (*) WAEvent (encolados para ingest)
    └── (*) PendingCommand (comandos del backend pendientes)
    └── (*) PendingMessage (mensajes en cola de envío)
    └── (*) WAContact (cache local de contactos)
    └── (*) WAChat (cache local de chats)
    └── (*) CacheEntry (TTL cache genérica)
```

### Esquema sugerido (en docs para integración)

El archivo `web/conversations/README.md` sugiere un esquema SQL para Supabase:

```sql
conversations:
  id UUID, session_id TEXT, contact_id TEXT, contact_name TEXT,
  contact_phone TEXT, profile_picture TEXT, is_group BOOLEAN,
  labels TEXT[], unread_count INT, last_message_at TIMESTAMPTZ

messages:
  id UUID, conversation_id UUID → conversations, whatsapp_msg_id TEXT,
  direction TEXT, type TEXT, body TEXT, caption TEXT, media_url TEXT,
  from_me BOOLEAN, author JSONB, ack INT, timestamp BIGINT, synced BOOLEAN
```

**Este esquema es solo documentación/recomendación, no código ejecutable en el proyecto.**

---

## 11. EVENTOS DEL SISTEMA

| Evento | Origen | Payload | Consumidores |
|--------|--------|---------|-------------|
| `NEW_MESSAGE` | WA-JS / DOM Detector | WAMessage | Backend ingest |
| `MESSAGE_SENT` | SenderEngine | `{ taskId, messageId }` | Backend ingest |
| `MESSAGE_FAILED` | SenderEngine | `{ taskId, error }` | Backend ingest |
| `MESSAGE_ACK` | message-detector.ts (polling) | `{ messageId, ack }` | Backend ingest |
| `ACTIVE_CHAT_CHANGED` | WA-JS | WAChat | Backend ingest |
| `PRESENCE_CHANGED` | WA-JS | WAPresence | Backend ingest |
| `LABEL_UPDATED` | WA-JS | `{ chatId, labels[], action }` | Backend ingest |
| `SESSION_READY` | whatsapp-engine.ts | SessionInfo | Backend ingest + SW activeSessions |
| `SESSION_LOST` | whatsapp-engine.ts | `{ error }` | Backend ingest |
| `HEARTBEAT` | SW alarms | `{ timestamp }` | Backend heartbeat endpoint |
| `CONNECTION_STATE_CHANGED` | WA-JS | `{ state, isSynchronized }` | Backend ingest |

### Flujo de eventos

```
[WA-JS Event] → [Injected Script]
                    ↓
            [postMessage → Content Script]
                    ↓
            [chrome.runtime.sendMessage → Background]
                    ↓
            [chrome.storage.local "eventQueue" (buffer)]
                    ↓
            [Alarm flush_ingest cada 5s]
                    ↓
            [POST /api/public/engine/ingest]
                    ↓
            [Backend CRM externo]
```

---

## 12. AUTOMATIZACIONES EXISTENTES

### 12.1 Rate Limiting de envío

- **Límite:** 30 mensajes por minuto.
- **Implementación:** `senderEngine.sentTimestamps[]` filtra timestamps > 1 minuto atrás.
- **Comportamiento:** Si se alcanza el límite, espera hasta que el más antiguo caiga fuera de la ventana.

### 12.2 Retry con backoff

- **Máximo:** 3 intentos.
- **Delay inicial:** 2000ms.
- **Backoff:** `SEND_RETRY_DELAY * retryCount` (2s, 4s, 6s).
- **Timeout por intento:** 30 segundos (AbortController).

### 12.3 Deduplicación de mensajes (DOM)

- **Mecanismo:** Map `SEEN` con TTL de 120 segundos.
- **Garbage collection:** Cada vez que se detecta un mensaje nuevo se limpian entradas antiguas.

### 12.4 Limpieza de cola

- **Límite:** La cola en `chrome.storage.local` nunca excede 500 eventos (FIFO truncamiento).
- **Cleanup alarm:** Cada 5 minutos se ejecuta `cleanupOldData()` (actualmente solo log, no implementado fully).

### 12.5 Heartbeat y timeout de sesión

- **Intervalo:** 15 segundos.
- **Timeout:** 45 segundos sin heartbeat = sesión marcada como perdida y eliminada de `activeSessions`.

---

## 13. PUNTOS DE EXTENSIÓN

### 13.1 Integrar con backend real

**Punto de inserción:** `extension/background/service-worker.ts:100-123` (pollCommands) y `:253-322` (flushIngestQueue).

La extensión ya espera un backend compatible. Solo requiere:
1. Implementar los 3 endpoints REST (`/commands`, `/ingest`, `/heartbeat`).
2. Generar y configurar `X-Session-Token`.

### 13.2 Añadir nuevos comandos

**Punto de inserción:** `extension/injected/whatsapp-engine.ts:74-137` (handleCommands switch).

Ejemplo: Añadir comando `ARCHIVE_CHAT`:
```typescript
case "ARCHIVE_CHAT":
  response = await WPP.chat.archive(payload.chatId);
  break;
```

### 13.3 Añadir nuevos eventos de WA-JS

**Punto de inserción:** `extension/injected/event-engine.ts:26-31` (registro de listeners).

WA-JS expone muchos más eventos (`chat.msg_revoke`, `chat.delete`, etc.) que pueden registrarse aquí.

### 13.4 Mejorar DOM Detector

**Punto de inserción:** `extension/content/dom-detector.ts`

- Los selectores están centralizados en `MSG_SELECTORS` y `PANEL_SELECTORS`.
- Es fácil añadir nuevas estrategias de extracción en `extractText()`, `extractTimestamp()`, `direction()`.

### 13.5 WebSocket en lugar de polling

**Punto de inserción:** Reemplazar `api/polling.ts` y la lógica de `pollCommands()` en el SW.

Ventaja: Latencia real para comandos entrantes en lugar de 3s de polling.

### 13.6 Soporte de multimedia avanzado

**Punto de inserción:** `extension/injected/sender-engine.ts:110-121` (sendFileMessage).

Actualmente acepta `media` como base64 string. Se puede extender para:
- Subida a CDN + envío de URL.
- Procesamiento de imágenes (resize, watermark).
- Descarga automática de media entrante.

---

## 14. DEPENDENCIAS ENTRE MÓDULOS

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Injected Script│────→│  Content Script │────→│ Background SW   │
│  (MAIN world)   │←────│  (ISOLATED)     │←────│ (MV3)           │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         ↑                       ↑                       ↑
   window.WPP              chrome.runtime        chrome.alarms + fetch
   window.postMessage       sendMessage         chrome.storage.local
```

| Módulo | Depende de | Si falla |
|--------|-----------|----------|
| **Injected Script** | `window.WPP` (WA-JS) | Se activa DOM Detector fallback |
| **Content Script** | Injected + Background | Bridge roto, eventos no llegan |
| **Background SW** | Backend URL + Token + Tabs | No hay sync con CRM; comandos se acumulan |
| **Sender Engine** | `WPP.chat.sendTextMessage` | No se envían mensajes salientes |
| **Event Engine** | `WPP` listeners | Se pierden eventos en tiempo real; DOM Detector cubre parcialmente |
| **DOM Detector** | DOM de WhatsApp Web | Si WA cambia selectores, falla detección |
| **Popup UI** | chrome.storage.local | No muestra estado real |

---

## 15. RIESGOS DE IMPLEMENTACIÓN

### 15.1 Fragilidad de WA-JS

- **WPPConnect/WA-JS** es ingeniería inversa de la API interna de WhatsApp Web. WhatsApp puede cambiar su estructura de webpack chunks en cualquier momento.
- `wpp-bootstrap.ts` tiene timeout de 30s. Si WPP no carga, el DOM Detector es el único fallback.
- **Riesgo alto:** Si WPP deja de funcionar, toda la detección nativa se rompe y solo queda el MutationObserver.

### 15.2 Fragilidad del DOM Detector

- Los selectores CSS (`MSG_SELECTORS`, `PANEL_SELECTORS`) son específicos de la versión actual de WhatsApp Web (2025-2026).
- WhatsApp actualiza su UI frecuentemente. Un cambio de `data-testid` puede romper la detección.
- El DOM Detector usa una estrategia agresiva (`scanAll`) que puede consumir CPU en chats largos.

### 15.3 Concurrencia del Service Worker MV3

- En Manifest V3, el Service Worker se suspende después de ~30s de inactividad.
- Los `chrome.alarms` despiertan el SW, pero hay un race condition: si un evento llega mientras el SW está dormido, puede perderse.
- El buffer en `chrome.storage.local` mitiga esto, pero el SW no procesa eventos en tiempo real mientras duerme.

### 15.4 Rate limiting de WhatsApp

- El rate limit interno es 30 msg/min, pero WhatsApp Web tiene sus propios límites no documentados.
- Enviar demasiados mensajes rápido puede resultar en bloqueo temporal de la cuenta.
- **Riesgo:** Un broadcast masivo mal configurado en el backend puede bloquear el número de WhatsApp.

### 15.5 Falta de backend embebido

- No hay forma de probar la extensión sin un backend compatible.
- No hay modo "standalone" ni simulador de backend.
- El desarrollador debe implementar 3 endpoints antes de que funcione.

### 15.6 Módulo web incompleto

- `web/conversations/` usa `localStorage` como fuente de datos (demo).
- No tiene conexión real con backend ni con la extensión.
- Requiere trabajo de integración significativo para ser funcional.

### 15.7 Acoplamiento de tipos

- Los tipos en `shared/types.ts` están fuertemente acoplados a la estructura de objetos de WPP.
- Si WPP cambia su formato de mensaje, todos los normalizadores se rompen.

---

## 16. PROPUESTA DE ARQUITECTURA FUTURA

### 16.1 Backend embebido (opcional)

Incluir un backend minimalista para testing/demo:
- Express/Fastify con los 3 endpoints.
- SQLite en memoria para persistencia de demo.
- Modo `standalone` en la extensión.

### 16.2 WebSocket real

Reemplazar polling HTTP por WebSocket:
- Conexión persistente entre extensión y backend.
- Comandos entrantes en tiempo real (< 100ms).
- Reconexión automática con backoff.

### 16.3 Sistema de plugins para eventos

- Permitir registrar handlers custom para eventos WPP sin modificar `event-engine.ts`.
- API tipo `engine.on("NEW_MESSAGE", (msg) => { ... })`.

### 16.4 Mejoras en DOM Detector

- Selector engine dinámico que se auto-ajuste (machine learning o heurística de fuzzy matching).
- Detección de cambios de versión de WhatsApp Web y alerta automática.

### 16.5 Dashboard web integrado

- Convertir `web/conversations/` en una aplicación web real conectada al backend.
- Incluir autenticación, gestión de múltiples sesiones, y analytics.

### 16.6 Soporte de multimedia completo

- Descarga automática de archivos entrantes (upload a S3/Supabase Storage).
- Previsualización de media en el popup.
- Envío de archivos drag & drop.

---

## 17. PLAN DE IMPLEMENTACIÓN SUGERIDO

### Fase 1: Robustecer bridge (1 semana)
1. Añadir tests unitarios para `normalizeMessage`, `direction`, `senderEngine`.
2. Implementar manejo de errores de red con exponential backoff en `flushIngestQueue`.
3. Añadir métricas de latencia y tasa de éxito.

### Fase 2: Mejorar DOM Detector (1 semana)
1. Centralizar selectores en un archivo de configuración externo (JSON) para poder actualizar sin recompilar.
2. Añadir detección de versión de WhatsApp Web.
3. Optimizar `scanAll()` para no escanear todo el DOM en cada ciclo.

### Fase 3: WebSocket (2 semanas)
1. Implementar cliente WebSocket en el background SW.
2. Crear fallback automático: WebSocket → HTTP polling.
3. Manejar reconexión con backoff.

### Fase 4: Backend demo (1-2 semanas)
1. Crear servidor Express con SQLite.
2. Implementar los 3 endpoints requeridos.
3. Panel web básico para ver mensajes y enviar comandos.

### Fase 5: Módulo web funcional (2 semanas)
1. Conectar `web/conversations/` con backend real vía API.
2. Implementar polling/WebSocket para mensajes en tiempo real.
3. Añadir envío de archivos.

### Fase 6: Escalabilidad (continuo)
1. Soporte para múltiples números de WhatsApp en un solo perfil Chrome (limitación de WA Web).
2. Cola de envío persistente en IndexedDB (actualmente solo en memoria).
3. Rate limiting configurable por usuario.

---

## ANEXO A: Archivos críticos del sistema

| Ruta | Líneas | Rol |
|------|--------|-----|
| `extension/background/service-worker.ts` | 422 | Coordinador central: alarms, polling, ingest, heartbeat, dispatch |
| `extension/content/dom-detector.ts` | 321 | Fallback de detección de mensajes por DOM |
| `extension/injected/sender-engine.ts` | 221 | Envío robusto con cola, retry, rate limit, AbortController |
| `extension/injected/event-engine.ts` | 210 | Listeners WPP + normalizadores de mensajes/chats |
| `extension/bridge/bridge.ts` | 220 | ContentBridge + BackgroundBridge |
| `extension/storage/db.ts` | 222 | Dexie DB completa |
| `extension/injected/whatsapp-engine.ts` | 149 | Entry point injected + router de comandos |
| `extension/shared/types.ts` | 176 | Tipos TypeScript completos |
| `extension/shared/contracts.ts` | 63 | Constantes, timeouts, endpoints |
| `docs/BACKEND_PROTOCOL.md` | 137 | Contrato de API esperado del backend |

---

## ANEXO B: Comparativa con `plan-maestro-crm`

| Aspecto | `plan-maestro-crm` | `maple-wa-engine` |
|---------|-------------------|-------------------|
| Tipo | CRM completo (web + extensión) | Bridge engine puro (extensión) |
| Backend | TanStack Start + Supabase | No tiene (espera backend externo) |
| DB | Supabase PostgreSQL con RLS | IndexedDB local (Dexie) |
| Extensión | Propio (MutationObserver) | WA-JS/WPPConnect + MutationObserver fallback |
| UI CRM | Completa (dashboard, chats, automations) | Solo popup de debug + módulo web opcional |
| IA | Gemini/GPT via Lovable/Vertex | No tiene |
| Automatizaciones | Auto-replies, scheduled, broadcasts | Rate limit, retry, dedup |
| Multi-sesión | Sí (wa_sessions) | Sí (perfiles Chrome + activeSessions Map) |
| Envío de media | No soportado | Sí (sendFileMessage con base64) |
| ACKs | Básicos (command ack) | Polling cada 500ms para acks de WA |
| Eventos | 5 tipos básicos | 15+ tipos (incluye presence, labels, connection state) |

---

*Fin del informe técnico.*
