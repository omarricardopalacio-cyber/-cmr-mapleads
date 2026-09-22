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

### Build de producción (extensión descomprimida)

La carpeta que se carga en Chrome es `etiqueta terminada/extension/dist`.

```bash
cd "etiqueta terminada/extension"
npm install
npm run build
```

`npm run build` ejecuta `tsc` y después `node build.js` (descarga WA-JS y empaqueta popup, service worker, content e injected). También se puede lanzar solo el empaquetado con `node build.js` desde esa misma carpeta, después de que `tsc` haya pasado.

En `chrome://extensions` → modo desarrollador → Cargar descomprimida → elegir `etiqueta terminada/extension/dist`.

### Recargar en el navegador que ya tiene la extensión

1. `chrome://extensions` → en MAPLE WA Engine pulsar **Recargar** (o Quitar y volver a **Cargar descomprimida** apuntando a `etiqueta terminada/extension/dist`).
2. Si Chrome muestra **Reinicia para actualizar**, cerrar Chrome por completo y abrirlo de nuevo. Hasta ese reinicio el content script viejo sigue en WhatsApp y el detector no ve mensajes nuevos.
3. Recargar la pestaña `https://web.whatsapp.com` (F5). El script de contenido solo se inyecta al cargar la página.
4. Abrir el popup → Debug. Tras un mensaje nuevo (aunque el chat no esté abierto: basta con que cambie la lista) debe aparecer el texto en **Último mensaje** y, en unos segundos, el hilo del CRM.

No hace falta una carpeta `extension/dist` en la raíz del repo: el build deja la extensión descomprimida en `etiqueta terminada/extension/dist`.

### Cargar en Chrome

1. Abrir `chrome://extensions/`
2. Activar "Modo desarrollador"
3. Click en "Cargar descomprimida"
4. Seleccionar la carpeta `etiqueta terminada/extension/dist/`

## LID y foto de perfil

WhatsApp a veces identifica un chat como `…@lid` (no es un celular). Antes de ingerir, la extensión pide el número real (`getPnLidEntry` / caché LID↔PN). Si lo resuelve, manda el celular en `phone`. Si no, manda `wa_id` terminado en `@lid` y deja `phone` vacío: no se inventa un `+1…` con los dígitos del LID. Al abrir o enriquecer el chat se adjunta `profilePictureUrl` solo si es la foto de ese peer. La foto del negocio / «yo» (mismo archivo del CDN, aunque cambie la firma) y los badges de no leídos no se envían.

## Configuración

1. Abrir WhatsApp Web (`web.whatsapp.com`)
2. Click en el icono de la extensión
3. Ir a la tab "Config"
4. Ingresar:
   - **Backend URL**: por defecto `https://creadorpaginasmapleads.netlify.app/crm`
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
