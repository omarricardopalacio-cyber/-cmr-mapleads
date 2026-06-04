# MAPLE WA ENGINE

> WhatsApp Web Bridge Engine for Cloud CRM

## ¿Qué es?

MAPLE WA Engine es una extensión Chrome profesional que conecta WhatsApp Web con tu CRM en la nube. No es un CRM — es el **puente** que permite a tu CRM enviar y recibir mensajes de WhatsApp en tiempo real.

## Características

- **Detección en tiempo real** de mensajes entrantes y salientes
- **Envío automático** con cola, retry y rate limit
- **Soporte multi-sesión** (varios perfiles Chrome)
- **Sincronización** con backend REST API
- **Panel de debug** integrado
- **Almacenamiento local** con IndexedDB + Dexie
- **Arquitectura modular** y escalable

## Stack

| Capa | Tecnología |
|------|-----------|
| UI Popup | React 18 + Vite + Tailwind CSS |
| Extensión | Chrome Manifest V3 |
| WhatsApp Engine | WA-JS / WPPConnect |
| Storage | IndexedDB + Dexie |
| Realtime | Polling + WebSocket opcional |

## Instalación

### Desarrollo

```bash
cd extension
npm install
npm run dev
```

### Build de producción

```bash
cd extension
npm run build
```

### Cargar en Chrome

1. Abrir `chrome://extensions/`
2. Activar "Modo desarrollador"
3. Click en "Cargar descomprimida"
4. Seleccionar la carpeta `extension/dist/`

## Configuración

1. Abrir WhatsApp Web (`web.whatsapp.com`)
2. Click en el icono de la extensión
3. Ir a la tab "Config"
4. Ingresar:
   - **Backend URL**: URL de tu CRM (`https://api.tu-crm.com`)
   - **Session Token**: Token de autenticación
5. Guardar

## Arquitectura

```
WhatsApp Web
    │
    ▼
Injected Script (WA-JS + Engine)
    │
    ▼
Content Script (Bridge)
    │
    ▼
Background Service Worker (API + Storage)
    │
    ▼
Backend CRM
```

## API del Backend

La extensión espera que tu backend implemente:

```
GET  /api/public/engine/commands
POST /api/public/engine/ingest
POST /api/public/engine/heartbeat
```

Ver `docs/BACKEND_PROTOCOL.md` para detalles completos.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Protocolo Backend](docs/BACKEND_PROTOCOL.md)
- [Flujo de Mensajes](docs/MESSAGE_FLOW.md)
- [Multi-Sesión](docs/MULTISESSION.md)
- [Debugging](docs/DEBUGGING.md)

## Licencia

MIT
