# 🚀 Sistema de Reintentos Mejorado - Resumen Implementado

## 📋 Cambios Implementados

### ✅ 1. Sistema de 7 Reintentos Inteligentes
**Archivo:** `src/lib/ai.server.ts`

```
┌─────────────────────────────────────┐
│ Intento 1-3: Silencioso             │
│ (backoff: 1s, 2s, 4s)               │
├─────────────────────────────────────┤
│ Intento 4: Notificación             │
│ "Permíteme un minuto, ya te         │
│  confirmo 😊"                        │
├─────────────────────────────────────┤
│ Intentos 5-6: Silencioso            │
├─────────────────────────────────────┤
│ Intento 7: Notificación             │
│ "Dame un ratito, ya te envío 😉"    │
├─────────────────────────────────────┤
│ ❌ Falla: Widget Apoyo + Auto-retry │
└─────────────────────────────────────┘
```

**Cambios:**
- `maxAttempts` aumentado de 3 a 7
- `onRetry()` callback ahora recibe número de intento
- Retorna información de `retryAttempt` en respuesta

---

### ✅ 2. Gestor de Reintentos Fallidos
**Archivo:** `src/lib/retry-manager.server.ts` (NUEVO)

Funciones principales:
```typescript
registerFailedAiRequest()        // Registra solicitud fallida
sendSupportMessage()             // Envía widget de apoyo
getPendingRetryRequests()        // Obtiene solicitudes pendientes
updateFailedRequest()            // Actualiza estado
cleanupOldResolvedRequests()     // Limpia solicitudes antiguas
```

---

### ✅ 3. Widget de Apoyo en Naranja
**Archivo:** `src/components/support-widget.tsx` (NUEVO)

```
╔════════════════════════════════════╗
║ ⚠️ ¿Necesitas ayuda?              ║
║                                    ║
║ Nuestro equipo de soporte está    ║
║ siendo notificado.                 ║
║                                    ║
║ Intentaremos responder en: 3:00   ║
║                                    ║
║ [Conectar con asesor]              ║
║                                    ║
║ El asesor revisará tu caso en    ║
║ los próximos minutos               ║
╚════════════════════════════════════╝
```

Características:
- Contador regresivo de 3 minutos
- Botón para conectar con asesor
- Gradiente naranja a rojo
- Actualización en tiempo real

---

### ✅ 4. Endpoint de Reintentos Automáticos
**Archivo:** `src/routes/api/public/engine/retry-processor.ts` (NUEVO)

```
POST /api/public/engine/retry-processor
```

Función: Procesa reintentos automáticos cada 5 minutos (configurable)

Algoritmo:
1. Obtiene solicitudes pendientes donde `next_retry_at ≤ NOW`
2. Ejecuta `runAiAgent()` con historial
3. Si éxito → status: "resolved"
4. Si fallo → incrementa counter, próximo intento en 3 min

---

### ✅ 5. Tabla de BD para Solicitudes Fallidas
**Archivo:** `supabase/migrations/20260610_failed_ai_requests.sql` (NUEVA)

```sql
CREATE TABLE failed_ai_requests (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL,
  thread_id UUID NOT NULL,
  chat_id TEXT NOT NULL,
  session_id UUID NOT NULL,
  original_message TEXT NOT NULL,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  next_retry_at TIMESTAMP NOT NULL,
  status TEXT DEFAULT 'pending',
  context_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para queries rápidas
CREATE INDEX idx_failed_ai_requests_org_status ON failed_ai_requests(org_id, status);
CREATE INDEX idx_failed_ai_requests_next_retry ON failed_ai_requests(next_retry_at) WHERE status = 'pending';
```

Estados:
- `pending`: Esperando reintento
- `retrying`: Actualmente reintentando
- `resolved`: Éxito
- `failed`: Máximo de reintentos agotado

---

### ✅ 6. Mejoras en Manejo de Errores
**Archivo:** `src/routes/api/public/engine/ingest.ts`

Cambios:
- Detecta errores de Vertex después de reintentos agotados
- Registra solicitud fallida con contexto
- Envía widget de apoyo en lugar de mensaje de error
- Mantiene separación entre errores de Vertex y otros

```typescript
const isVertexError = errMsg.includes('Vertex') && 
                      errMsg.includes('after all retry attempts');
```

---

### ✅ 7. Integración en Chat
**Archivo:** `src/routes/_authenticated.conversations.$threadId.tsx`

Cambios:
- Importa `SupportWidget`
- Detecta mensajes con formato `[SUPPORT_WIDGET:requestId:threadId]`
- Renderiza widget en lugar de mensaje de texto
- Mantiene sincronización con BD en tiempo real

```typescript
if (isSupportWidget && supportRequestId) {
  return <SupportWidget requestId={requestId} threadId={threadId} />;
}
```

---

### ✅ 8. API de Administración
**Archivo:** `src/routes/api/admin/engine/failed-requests.ts` (NUEVA)

Endpoints:
```
GET    /api/admin/engine/failed-requests
       - Lista solicitudes (filtrable por status)

POST   /api/admin/engine/failed-requests
       - Fuerza reintento inmediato

DELETE /api/admin/engine/failed-requests?id=...
       - Marca como resuelto manualmente
```

Autenticación: Bearer token (usuario debe tener admin)

---

## 🔄 Flujo Completo

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Usuario envía mensaje                                    │
├─────────────────────────────────────────────────────────────┤
│ 2. AI Agent intenta con callVertexAI()                       │
│    └─ Intentos 1-7 con reintentos inteligentes             │
├─────────────────────────────────────────────────────────────┤
│ 3. Si falla ALL:                                            │
│    ├─ Registra en failed_ai_requests                        │
│    ├─ Envía comando SEND_MESSAGE con widget                │
│    └─ Widget aparece en chat (naranja)                     │
├─────────────────────────────────────────────────────────────┤
│ 4. Cron Job cada 5 minutos:                                │
│    ├─ Obtiene solicitudes pendientes                       │
│    ├─ Si next_retry_at llegó, intenta resolver            │
│    └─ Envía respuesta si tiene éxito                      │
├─────────────────────────────────────────────────────────────┤
│ 5. Usuario ve:                                             │
│    ├─ Widget naranja con timer                            │
│    ├─ Botón de contacto con asesor                        │
│    └─ Respuesta cuando se resuelva automáticamente        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Configuración Requerida

### 1. Ejecutar Migración SQL
```sql
-- Copiar contenido de:
-- supabase/migrations/20260610_failed_ai_requests.sql
-- en SQL Editor de Supabase
```

### 2. Configurar Cron Job (Elegir UNA opción)

**Opción A: Supabase**
```sql
select cron.schedule(
  'process-ai-retries',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url:='https://tu-dominio.com/api/public/engine/retry-processor',
      headers:='{"Content-Type": "application/json", "x-service-token": "tu-token"}'::jsonb,
      body:='{"trigger":"cron"}'::jsonb
    );
  $$
);
```

**Opción B: Vercel**
```json
// vercel.json
{
  "crons": [{
    "path": "/api/public/engine/retry-processor",
    "schedule": "*/5 * * * *"
  }]
}
```

**Opción C: Externo (EasyCron, UptimeRobot)**
- POST cada 5 minutos a: `https://tu-dominio.com/api/public/engine/retry-processor`
- Header: `x-service-token: tu-token-secreto`

### 3. Variable de Entorno (opcional)
```bash
SERVICE_TOKEN=tu-token-secreto-aqui
```

---

## 📊 Monitoreo

### Ver Solicitudes Pendientes
```sql
SELECT * FROM failed_ai_requests 
WHERE status = 'pending' 
ORDER BY next_retry_at ASC;
```

### Ver Estadísticas
```sql
SELECT 
  status,
  COUNT(*) as cantidad,
  AVG(retry_count) as avg_retries
FROM failed_ai_requests
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

### Logs Importantes
```
[callVertexAI] - Información sobre reintentos
[ai-reply] - Detalles de errores
[retry-processor] - Ejecución de procesador
```

---

## 🐛 Solución: Pedidos No Registrados

### Problema
La IA a veces dice "pedido registrado" pero NO ejecuta `confirm_order` tool.

### Soluciones Implementadas
1. **Detección automática** → Reemplaza respuesta
2. **Herramienta de reparación** → `repairMissingConfirmedOrders()`
3. **Mejora de prompt** → Instrucciones claras sobre `confirm_order`

### Uso
```typescript
import { repairMissingConfirmedOrders } from '@/lib/orders.functions'

// En componente o edge function
const result = await repairMissingConfirmedOrders();
console.log(`Reparados: ${result.repaired} pedidos`);
```

---

## 📈 Métricas Esperadas

| Métrica | Antes | Después |
|---------|-------|---------|
| Fallos sin recuperación | 100% | ~5-10% |
| Reintentos manuales requeridos | Muchos | Casi 0 |
| Tiempo de resolución | Manual | Automático (3-15 min) |
| Experiencia del usuario | Confusa | Clara con widget |

---

## ✨ Próximas Optimizaciones (Opcionales)

1. Dashboard de reintentos para admins
2. Notificaciones en tiempo real cuando se resuelve
3. Estadísticas de éxito por provider
4. A/B testing de mensajes de reintentos
5. Integración con Slack para alertas críticas

---

**Versión:** 1.0  
**Fecha:** 10 Junio 2026  
**Estado:** ✅ Listo para producción
