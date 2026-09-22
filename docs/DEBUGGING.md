# MAPLE WA ENGINE — Debugging

## Panel Debug

Acceder desde el popup de la extensión (click en el icono de la barra de Chrome).

**Último mensaje** sale vacío si el detector solo miraba el chat abierto y WhatsApp está en la lista (panel de llamadas a la derecha). Desde 1.0.16 la lista izquierda también cuenta: un no-leído de la última media hora, o un cambio de preview reciente, se ingiere sin abrir el chat.

Si Chrome dice **Reinicia para actualizar**, hay que cerrar Chrome, volver a cargar `etiqueta terminada/extension/dist` y refrescar `web.whatsapp.com`. El content script viejo no ve el DOM nuevo.

Un error rojo de ingest no se queda pegado mientras el poll de comandos responde JSON (OK BACKEND). Un `400 Invalid payload` por un lote vacío no se trata como «el CRM no devolvió JSON».

### Tabs del Popup

1. **Status**: Estado de WPP, sesión, backend, cola, último mensaje/comando
2. **Config**: Backend URL y Session Token
3. **Sessions**: Lista de sesiones activas con detalles
4. **Queue**: Cantidad de eventos en cola

## Logs por Consola

### WhatsApp Web (DevTools de la página)

Filtrar por: `[WhatsAppEngine]`, `[EventEngine]`, `[SenderEngine]`

```
[WhatsAppEngine] Iniciando...
[WhatsAppEngine] WPP listo
[WhatsAppEngine] EventEngine listo
[WhatsAppEngine] Listo y escuchando comandos
```

### Content Script (DevTools de la página → Content Scripts)

Filtrar por: `[ContentScript]`, `[ContentBridge]`

```
[ContentScript] Iniciando...
[ContentScript] WPP detectado, inyectando engine
[ContentBridge] Inicializado
```

### Background Worker (chrome://extensions → Service Worker)

Filtrar por: `[ServiceWorker]`, `[BackgroundBridge]`

```
[ServiceWorker] Extensión instalada/actualizada
[ServiceWorker] Comando recibido: SEND_MESSAGE cmd-123
[ServiceWorker] Ingest: 15 eventos sincronizados
```

## Comandos Manuales

### Desde la consola de WhatsApp Web

```javascript
// Verificar WPP cargado
console.log(window.WPP);

// Enviar mensaje manual
window.WPP.chat.sendTextMessage("1234567890@c.us", "Hola");

// Ver sesión del engine
console.log(window.__MAPLE_WA_ENGINE_INITIALIZED);
```

### Desde el Content Script

```javascript
// Acceder al bridge
const bridge = window.__MAPLE_CONTENT_BRIDGE;

// Enviar comando al injected script
bridge.sendToInjected({
  channel: "WA_COMMAND",
  event: "PING",
  payload: {}
});
```

### Desde el Background Worker

```javascript
// Listar tabs de WhatsApp
chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, console.log);

// Enviar mensaje a una tab específica
chrome.tabs.sendMessage(tabId, {
  source: "MAPLE_WA_BACKGROUND",
  channel: "WA_COMMAND",
  event: "PING"
});
```

## Problemas Comunes

### WPP no carga

- Verificar conexión a internet (WA-JS se carga desde CDN)
- Recargar WhatsApp Web
- Verificar que `window.WPP` existe en la consola de WhatsApp Web

### Eventos no llegan al backend

- Verificar `X-Session-Token` configurado en popup
- Verificar `backendUrl` accesible
- Revisar cola en popup (tab Queue)
- Revisar logs del service worker

### Mensajes no se envían

- Verificar rate limit (30/min)
- Verificar `canSend` del chat
- Revisar logs del sender engine
- Verificar que WPP está listo

### Múltiples sesiones conflictivas

- WhatsApp Web solo permite 1 sesión por número
- Cerrar tabs duplicadas
- Usar diferentes perfiles de Chrome para diferentes números
