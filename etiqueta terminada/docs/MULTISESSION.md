# MAPLE WA ENGINE — Multi-Sesión

## Identificación de Sesiones

Cada instancia de WhatsApp Web tiene un identificador único compuesto por:

```
sessionId: `wa-${phoneNumber}-${timestamp}`
browserId: "chrome"
deviceId:  phoneNumber
```

Ejemplo:
```
sessionId: "wa-573001234567-1717000000000"
browserId: "chrome"
deviceId:  "573001234567"
```

## Escenarios Soportados

### 1. Múltiples Perfiles Chrome

Cada perfil de Chrome tiene su propio:
- `chrome.storage.local`
- `chrome.runtime.id` (mismo ID de extensión, pero sandbox separado)
- Service Worker independiente

La extensión opera completamente aislada por perfil.

### 2. Múltiples Tabs de WhatsApp Web

En un mismo perfil Chrome, el usuario puede abrir:
- `web.whatsapp.com` en Tab 1 (Sesión A)
- `web.whatsapp.com` en Tab 2 (Sesión B) — WhatsApp no permite múltiples tabs, pero puede ocurrir con diferentes perfiles

El background worker maneja múltiples tabs:

```typescript
const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
```

Cada tab tiene un `tabId` único.

### 3. Comandos Dirigidos

El backend puede enviar un comando a una sesión específica:

```json
{
  "id": "cmd-123",
  "type": "SEND_MESSAGE",
  "targetSessionId": "wa-573001234567-1717000000000",
  "payload": { ... }
}
```

El background worker:
1. Recibe el comando vía polling
2. Busca la sesión en `activeSessions`
3. Si la encuentra, envía a la tab correspondiente
4. Si no, envía a la primera tab disponible

### 4. Heartbeat por Sesión

Cada sesión envía heartbeat independiente:

```typescript
for (const [sessionId, session] of activeSessions) {
  await sendHeartbeat(session);
}
```

Timeout por sesión: 45 segundos sin heartbeat = sesión marcada como perdida.

## Estado del Sistema

```typescript
// Mapa de sesiones activas en memoria
activeSessions: Map<string, SessionInfo>

// Persistencia en IndexedDB
await db.sessions.put(session);
```

## Limitaciones

- WhatsApp Web oficialmente solo permite 1 sesión activa por número de teléfono
- Múltiples tabs del mismo número causarán desconexión de una de ellas
- La extensión soporta múltiples sesiones, pero WA Web tiene sus propias restricciones
