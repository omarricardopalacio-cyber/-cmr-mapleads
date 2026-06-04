# MAPLE WA ENGINE — Message Flow

## Mensaje Entrante

```
[WhatsApp WebSocket recibe mensaje]
           │
           ▼
[Store.Msg.add() interceptado por WA-JS]
           │
           ▼
[WPP.prependListener("chat.new_message")]
           │
           ▼
[event-engine.ts: normalizeMessage()]
           │
           ▼
[window.postMessage({type:"WA_EVENT", event:"NEW_MESSAGE"})]
           │
           ▼
[Content Script: handleInjectedMessage]
           │
           ▼
[sendToBackground("WA_EVENT")]
           │
           ▼
[Background: handleWAEvent]
           │
           ▼
[IndexedDB: enqueueEvent(event)]
           │
           ▼
[IngestService.flush() cada 5s]
           │
           ▼
[POST /api/public/engine/ingest]
           │
           ▼
[CRM Cloud recibe evento]
```

## Mensaje Saliente

```
[CRM Cloud envía comando SEND_MESSAGE]
           │
           ▼
[GET /api/public/engine/commands]
           │
           ▼
[Background: dispatchCommand()]
           │
           ▼
[chrome.tabs.sendMessage → Content Script]
           │
           ▼
[ContentBridge.sendToInjected()]
           │
           ▼
[window.postMessage({channel:"WA_COMMAND", event:"SEND_MESSAGE"})]
           │
           ▼
[Injected Script: handleCommands]
           │
           ▼
[senderEngine.send({chatId, text})]
           │
           ▼
[Rate limit check: 30 msg/min]
           │
           ▼
[WPP.chat.sendTextMessage(chatId, text)]
           │
           ▼
[WhatsApp Web envía mensaje]
           │
           ▼
[WA-JS emite chat.new_message (fromMe=true)]
           │
           ▼
[Evento MESSAGE_SENT → Backend]
```

## Cola de Envío

```
[SEND_MESSAGE recibido]
           │
           ▼
[SenderEngine.queue.push(task)]
           │
           ▼
[processQueue()]
           │
           ▼
[waitForRateLimit()]
           │
           ▼
[executeTask() con AbortController]
           │
           ├─ Success → emitStatus("sent")
           ├─ Retry → retryCount++ (max 3)
           └─ Fail → emitStatus("failed")
```

## Normalización de Mensajes

```typescript
{
  messageId: msg.id._serialized,
  chatId: msg.id.remote._serialized,
  from: msg.from?._serialized,
  to: msg.to?._serialized,
  body: msg.body || msg.caption || "",
  type: msg.type, // "chat" | "image" | "video" | ...
  timestamp: msg.t,
  fromMe: msg.id.fromMe,
  author: { device, server, user, serialized },
  media: { mimetype, filehash, mediaKey, size, duration, caption },
  ack: msg.ack
}
```
