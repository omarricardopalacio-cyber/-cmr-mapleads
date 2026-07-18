# MAPLE WA ENGINE — Arquitectura

## Overview

MAPLE WA Engine es una extensión Chrome Manifest V3 que actúa como **bridge engine** entre WhatsApp Web y un CRM cloud externo (Lovable).

No contiene lógica CRM. Solo:
- Detecta eventos de WhatsApp Web
- Sincroniza mensajes, chats y contactos
- Envía mensajes automáticamente
- Expone una API bridge para el CRM

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend UI | React 18 + Vite + Tailwind CSS |
| Extensión | Chrome Manifest V3 |
| WhatsApp Engine | WA-JS / WPPConnect |
| Storage | IndexedDB + Dexie |
| Realtime | Polling fallback + WebSocket opcional |
| Backend | REST API compatible |

## Estructura

```
extension/
├── manifest.json
├── background/
│   └── service-worker.ts     # Coordina tabs, backend API, alarms
├── content/
│   ├── index.ts              # Inyecta WA-JS + engine en WhatsApp Web
│   └── bridge-listener.ts    # Helpers de bridge
├── injected/
│   ├── whatsapp-engine.ts    # Entry point inyectado
│   ├── wpp-bootstrap.ts      # waitForWPP()
│   ├── event-engine.ts       # Listeners WPP (new_message, active_chat, etc)
│   ├── chat-detector.ts      # getActiveChat, getChatList, findChat
│   ├── message-detector.ts   # getMessageById, ack subscription
│   ├── contact-detector.ts   # getContactList, getProfilePicture
│   ├── sender-engine.ts      # Cola de envío con retry y rate limit
│   └── command-engine.ts     # (reservado) comandos del backend
├── bridge/
│   ├── event-bus.ts          # Bus de eventos tipado
│   ├── postmessage.ts        # postMessage helpers
│   └── bridge.ts             # ContentBridge + BackgroundBridge
├── api/
│   ├── backend-client.ts     # HTTP client
│   ├── polling.ts            # Polling service
│   └── ingest.ts             # Batch ingest service
├── storage/
│   └── db.ts                 # Dexie DB (events, commands, messages, cache)
├── popup/
│   └── React UI              # Config + debug panel
└── shared/
    ├── types.ts              # Interfaces y tipos
    └── contracts.ts          # Constantes y endpoints
```

## Flujo de Datos

```
WhatsApp Web
    │
    │ Store.Msg.add() interceptado por WA-JS
    │
    ▼
Injected Script (whatsapp-engine.js)
    ├─ WPP.on("chat.new_message")
    ├─ WPP.on("chat.active_chat")
    ├─ WPP.on("chat.presence_change")
    └─ senderEngine.send()
    │
    │ window.postMessage
    ▼
Content Script (content/index.js)
    ├─ ContentBridge
    └─ chrome.runtime.sendMessage
    │
    ▼
Background Service Worker
    ├─ Alarms: polling, heartbeat, flush, cleanup
    ├─ Polling: GET /commands
    ├─ Ingest: POST /ingest (batch)
    └─ IndexedDB: queue de eventos
    │
    ▼
Backend API (CRM Cloud)
    ├─ GET /api/public/engine/commands
    └─ POST /api/public/engine/ingest
```

## Capas

### 1. Injected Script
Ejecuta en el contexto de WhatsApp Web. Tiene acceso a `window.WPP`.

Responsabilidades:
- Esperar WPP (`waitForWPP`)
- Registrar listeners de eventos
- Ejecutar comandos (enviar mensajes, obtener chats)
- Enviar eventos al Content Script vía `postMessage`

### 2. Content Script
Ejecuta en el contexto aislado de la extensión pero con acceso al DOM.

Responsabilidades:
- Inyectar WA-JS desde CDN
- Inyectar `whatsapp-engine.js`
- Escuchar mensajes del injected script
- Reenviar eventos al background vía `chrome.runtime.sendMessage`
- Reenviar comandos del background al injected script

### 3. Background Service Worker
Ejecuta en segundo plano, independiente de las tabs.

Responsabilidades:
- Polling de comandos del backend
- Heartbeat de sesiones
- Flush de eventos a ingest
- Gestión de múltiples sesiones
- IndexedDB para cola offline

### 4. Popup UI
Panel de configuración y debug.

Responsabilidades:
- Configurar backend URL y session token
- Monitorear estado del engine
- Ver sesiones activas
- Ver cola de eventos

## Eventos

| Evento | Origen | Destino |
|--------|--------|---------|
| NEW_MESSAGE | WA-JS | Backend |
| MESSAGE_SENT | SenderEngine | Backend |
| MESSAGE_FAILED | SenderEngine | Backend |
| ACTIVE_CHAT_CHANGED | WA-JS | Backend |
| PRESENCE_CHANGED | WA-JS | Backend |
| SESSION_READY | WA-JS | Backend |
| SESSION_LOST | WA-JS | Backend |
| HEARTBEAT | Background | Backend |

## Comandos

| Comando | Acción |
|---------|--------|
| SEND_MESSAGE | Enviar mensaje de texto/media |
| GET_ACTIVE_CHAT | Obtener chat activo |
| GET_CHAT_LIST | Listar chats |
| GET_CHAT_MESSAGES | Obtener mensajes de un chat |
| GET_CONTACT_LIST | Listar contactos |
| GET_CONTACT | Obtener contacto específico |
| GET_PROFILE_PICTURE | Obtener foto de perfil |
| GET_LABELS | Listar etiquetas nativas |
| PING | Health check |

## Seguridad

- `X-Session-Token` header en todas las requests
- Rate limit: 30 mensajes/minuto
- Retry con backoff exponencial
- Timeout de 30s en envíos
- AbortController para cancelar tareas
- Deduplicación por taskId
- Limpieza automática de observers e intervals
