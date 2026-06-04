# MAPLE WA ENGINE — Backend Protocol

## Autenticación

Todas las requests deben incluir:

```
X-Session-Token: <token>
Content-Type: application/json
```

## Endpoints

### 1. Obtener Comandos

```
GET /api/public/engine/commands
```

**Headers:**
- `X-Session-Token: <token>`

**Response:**
```json
[
  {
    "id": "cmd-123",
    "type": "SEND_MESSAGE",
    "targetSessionId": "wa-1234567890-1234567890",
    "payload": {
      "chatId": "1234567890@c.us",
      "text": "Hola, ¿en qué puedo ayudarte?"
    },
    "createdAt": "2026-05-29T18:00:00Z"
  }
]
```

**Polling:** cada 3 segundos desde el service worker.

### 2. Ingest de Eventos

```
POST /api/public/engine/ingest
```

**Headers:**
- `X-Session-Token: <token>`
- `Content-Type: application/json`

**Body:**
```json
{
  "sessionId": "wa-1234567890-1234567890",
  "browserId": "chrome",
  "deviceId": "1234567890",
  "events": [
    {
      "id": "evt-1",
      "type": "NEW_MESSAGE",
      "payload": {
        "messageId": "msg_abc123",
        "chatId": "1234567890@c.us",
        "from": "1234567890@c.us",
        "to": "0987654321@c.us",
        "body": "Hola",
        "type": "chat",
        "timestamp": 1717000000,
        "fromMe": false
      },
      "timestamp": 1717000000
    }
  ]
}
```

**Batch size:** máximo 50 eventos por request.

**Flush interval:** cada 5 segundos.

### 3. Heartbeat

```
POST /api/public/engine/heartbeat
```

**Body:**
```json
{
  "sessionId": "wa-1234567890-1234567890",
  "browserId": "chrome",
  "deviceId": "1234567890",
  "timestamp": 1717000000
}
```

**Interval:** cada 15 segundos.

**Timeout:** si no hay heartbeat en 45 segundos, la sesión se marca como perdida.

## Tipos de Comandos

| Tipo | Payload | Descripción |
|------|---------|-------------|
| `SEND_MESSAGE` | `{ chatId, text, media?, caption?, quotedMsgId? }` | Enviar mensaje |
| `SEND_BROADCAST` | `{ chatIds[], text, media? }` | Enviar broadcast |
| `GET_CHATS` | `{}` | Solicitar lista de chats |
| `GET_CONTACTS` | `{}` | Solicitar lista de contactos |
| `UPDATE_LABEL` | `{ chatId, labelId, action: "add" | "remove" }` | Actualizar etiqueta |
| `PING` | `{}` | Health check |

## Tipos de Eventos

| Tipo | Payload | Descripción |
|------|---------|-------------|
| `NEW_MESSAGE` | `WAMessage` | Mensaje nuevo recibido/enviado |
| `MESSAGE_SENT` | `{ taskId, messageId }` | Confirmación de envío |
| `MESSAGE_FAILED` | `{ taskId, error }` | Error de envío |
| `MESSAGE_ACK` | `{ messageId, ack }` | Estado de entrega |
| `ACTIVE_CHAT_CHANGED` | `WAChat` | Chat activo cambió |
| `PRESENCE_CHANGED` | `WAPresence` | Presencia cambió |
| `LABEL_UPDATED` | `{ chatId, labels[] }` | Etiquetas actualizadas |
| `SESSION_READY` | `SessionInfo` | Sesión lista |
| `SESSION_LOST` | `{ error }` | Sesión perdida |
| `HEARTBEAT` | `{ timestamp }` | Heartbeat periódico |

## Códigos de Error

| Código | Descripción |
|--------|-------------|
| `WPP_LOAD_TIMEOUT` | WA-JS no cargó en 30s |
| `SEND_ABORTED` | Envío cancelado por timeout |
| `SEND_ERROR` | Error genérico de envío |
| `RATE_LIMIT` | Límite de envío alcanzado |
| `NO_SESSION` | No hay sesión activa |
| `BACKEND_ERROR` | Error del backend |
