# Refactor: WhatsApp Bridge Engine

Convertir la extensión actual en un **runtime de transporte puro**, modular y desacoplado, sin romper el pipeline que ya funciona (observer + sender DOM + long-poll).

## Principios
- Extensión = solo transporte. IA / flows / CRM viven en el backend.
- Mantener selectores y fallback DOM actuales (funcionan).
- Reemplazar `execCommand` por `InputEvent` moderno con fallback.
- `setInterval` → `chrome.alarms` en background.
- Storage en `IndexedDB` para colas y dedup persistente.
- Event bus interno con contratos tipados.

## Estructura nueva (`extension/`)

```text
extension/
├── manifest.json
├── background/
│   ├── index.js              # service worker entry, registra alarms
│   ├── alarms.js             # poll, heartbeat, flush, recovery
│   ├── bridge-client.js      # fetch /ingest, /commands, /ack
│   └── command-dispatcher.js # enruta comandos a content
├── content/
│   ├── index.js              # bootstrap: event-bus + módulos
│   ├── core/
│   │   ├── event-bus.js
│   │   ├── selector-engine.js     # registry + multi-fallback
│   │   ├── observer-manager.js    # MutationObserver + recovery
│   │   ├── message-detector.js    # in/out via testid + estructura
│   │   ├── message-parser.js
│   │   └── message-sender.js      # Store API → DOM InputEvent fallback
│   ├── session/
│   │   ├── session-manager.js     # SPA nav, chat-changed
│   │   └── heartbeat.js
│   ├── queue/
│   │   ├── send-queue.js          # per-chat mutex
│   │   ├── retry-queue.js         # exp backoff
│   │   └── dead-letter.js
│   ├── storage/
│   │   ├── idb.js                 # IndexedDB wrapper
│   │   ├── dedup-store.js         # TTL cache persistente
│   │   └── cache.js
│   ├── recovery/
│   │   ├── observer-recovery.js
│   │   └── health-check.js
│   └── bridge/
│       └── bridge.js              # puente content ↔ background
├── shared/
│   ├── contracts.js               # event/command schemas (JSDoc typed)
│   └── constants.js
├── popup.html / popup.js
└── icon.png
```

## Contratos de eventos (shared/contracts.js)

```js
// MESSAGE_RECEIVED, MESSAGE_SENT, MESSAGE_FAILED,
// CHAT_OPENED, CHAT_CHANGED, SESSION_READY, SESSION_LOST,
// QUEUE_RETRY, ACK
{ event, sessionId, chatId, waMessageId, direction, text, timestamp }
```

## Pipeline conservado
- `focusComposer → injectText (InputEvent) → dispatchEvents → clickSend → verifySent`
- Store API como método 1, DOM como fallback.
- Dedup 3 capas: `seenMessageIds` (TTL en IDB) + `lastProcessedMessages` + `replied cooldown` por chat.

## Eliminado
- Mutex global `isProcessing` → `ChatLock` por `chatId`.
- Historial IA en RAM → backend.
- Cualquier hack tipo unlock-premium / sidebar / modal.

## Backend (sin tocar lógica existente)
- `/api/public/engine/ingest` ya existe → añadir validación de `event` contra contratos.
- `/api/public/engine/commands` ya existe → añadir `ack` endpoint:
  - `POST /api/public/engine/ack` con `{ commandId, status, error? }`
- Tabla `engine_commands` ya tiene `status/delivered_at`; añadir `acked_at`, `last_error`, `attempts`.

## Migración por fases (commits atómicos)

**Fase 1 — Esqueleto + event-bus (no rompe nada)**
- Crear `shared/contracts.js`, `content/core/event-bus.js`, `content/storage/idb.js`.
- `background/index.js` con `chrome.alarms` (poll 3s, heartbeat 15s, flush 1.5s).

**Fase 2 — Mover lógica existente a módulos**
- `observer.js` → `content/core/observer-manager.js` + `message-detector.js`.
- `parser.js` → `content/core/message-parser.js`.
- `sender.js` → `content/core/message-sender.js` con InputEvent moderno + fallback execCommand (transición).
- `bridge.js` → `content/bridge/bridge.js`.

**Fase 3 — Colas + dedup persistente**
- `send-queue.js` con mutex por chat.
- `retry-queue.js` con backoff `[1s, 3s, 10s, 30s]`.
- `dedup-store.js` en IndexedDB con TTL 120s.

**Fase 4 — Recovery + health**
- `observer-recovery.js`: detecta observer stale (sin mutaciones > 30s con `#main` presente) y rebuildea.
- `health-check.js`: ping alarm cada 30s, emite `SESSION_LOST` si falla.

**Fase 5 — Backend ACK + contratos**
- Migración: añadir columnas a `engine_commands`.
- Endpoint `/ack`.
- Validación de eventos en `/ingest`.

**Fase 6 — Anti-ban pacing**
- Delays aleatorios 600–1800ms entre sends del mismo chat.
- Throttling global: max 1 send/600ms.

## Confirmación antes de empezar

Antes de tocar código quiero confirmar 3 cosas:

1. **¿Procedo fase por fase con commits independientes?** (recomendado — cada fase verifica que WhatsApp sigue funcionando antes de la siguiente).
2. **¿Mantengo compatibilidad de la URL/token actuales** (popup ya configurado en `chrome.storage.local`)? Sí por defecto.
3. **¿Migración backend ahora o al final?** Recomiendo Fase 5 para no romper sesiones activas.

Si confirmas, arranco con **Fase 1 + Fase 2** en el primer commit (esqueleto + migración mecánica de los 4 archivos actuales a la nueva estructura, sin cambiar comportamiento).
