# Sistema de Reintentos Mejorado - Configuración y Uso

## 🎯 Resumen de Cambios

Se ha implementado un sistema robusto de reintentos para la IA (Vertex) con las siguientes características:

### ✅ Sistema de Reintentos Inteligente (7 intentos)
- **Intentos 1-3**: Silenciosos con backoff exponencial (1s, 2s, 4s)
- **Intento 4**: Notifica "Permíteme un minuto, ya te confirmo 😊"
- **Intentos 5-6**: Continuos sin notificación
- **Intento 7**: Notifica "Dame un ratito, ya te envío 😉"
- **Si falla todo**: Registra solicitud fallida y muestra widget de apoyo

### ✅ Widget de Apoyo en Naranja
Cuando falla Vertex después de 7 intentos:
- Se muestra un widget naranja en el chat
- Contador de 3 minutos para reintento automático
- Botón "Conectar con asesor" para contacto directo
- El cliente puede contactar soporte mientras se reintentan automáticamente

### ✅ Reintentos Automáticos
- Se ejecutan automáticamente cada 3 minutos (máximo 3 intentos)
- Utilizan el historial de mensajes completo
- Mantienen el contexto de la conversación
- Si tiene éxito, envía la respuesta sin notificación adicional

---

## 🔧 Configuración Requerida

### 1. Ejecutar la Migración de BD

```sql
-- Crear tabla failed_ai_requests
-- Ver archivo: supabase/migrations/20260610_failed_ai_requests.sql
```

**Pasos:**
1. En Supabase, ir a SQL Editor
2. Crear nueva query
3. Copiar contenido de `supabase/migrations/20260610_failed_ai_requests.sql`
4. Ejecutar

### 2. Configurar Cron Job para Reintentos Automáticos

El endpoint para procesar reintentos está en:
```
POST /api/public/engine/retry-processor
```

**Opciones de configuración:**

#### Opción A: Supabase Cron (Recomendado)

```sql
-- Crear trigger que ejecute el processor cada 1-5 minutos
select cron.schedule(
  'process-ai-retries',
  '*/5 * * * *',  -- Cada 5 minutos
  $$
    SELECT net.http_post(
      url:='https://tu-dominio.com/api/public/engine/retry-processor',
      headers:='{"Content-Type": "application/json", "x-service-token": "tu-token-secreto"}'::jsonb,
      body:='{"trigger":"cron"}'::jsonb
    ) as request_id;
  $$
);
```

#### Opción B: Vercel Crons (Si usas Vercel)

Agregar a `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/public/engine/retry-processor",
    "schedule": "*/5 * * * *"
  }]
}
```

#### Opción C: Llamadas Externas (Uptime/Monitoring)

Usar servicio como UptimeRobot, EasyCron, o similar para hacer POST cada 5 minutos:
- URL: `https://tu-dominio.com/api/public/engine/retry-processor`
- Headers: `x-service-token: tu-token-secreto`

### 3. Configurar Variable de Entorno (Opcional)

```bash
SERVICE_TOKEN=tu-token-secreto-aqui
```

---

## 📊 Flujo de Funcionamiento

```
┌─ Usuario envía mensaje
│
├─ AI Agent intenta responder (7 reintentos)
│  ├─ Intentos 1-3: Silencioso (backoff)
│  ├─ Intento 4: Notifica al usuario
│  ├─ Intentos 5-6: Silencioso
│  ├─ Intento 7: Notifica al usuario
│  └─ ❌ Todos fallan → Registra solicitud
│
├─ Se inserta comando SEND_MESSAGE con widget "apoyo"
│  └─ Usuario ve widget naranja de soporte
│
├─ Se registra en tabla failed_ai_requests
│  └─ status: "pending"
│  └─ next_retry_at: NOW + 3 minutos
│
├─ Cron/Job ejecuta cada 5 minutos
│  └─ Si next_retry_at ha llegado, intenta resolver
│
└─ Reintento automático
   ├─ Si ✅ Éxito → status: "resolved"
   └─ Si ❌ Falla → retry_count++, next_retry_at: NOW + 3 minutos
```

---

## 🐛 Problema de Pedidos No Registrados - Solución

### Causa Raíz
La IA a veces **dice** que confirmó el pedido pero **NO ejecuta** el tool `confirm_order`, lo que resulta en que el pedido no se guarda.

### Soluciones Implementadas

#### 1. Detección Automática
El sistema detecta si la IA reclama confirmación sin ejecutar `confirm_order` y:
- Reemplaza el mensaje con: "Permíteme un momento para registrar tu pedido en el sistema..."
- Intenta recuperar datos del historial
- Guarda el pedido automáticamente

#### 2. Herramienta de Reparación
Si aún así algunos pedidos no se guardan, ejecutar:
```typescript
// En el backend o componente
import { repairMissingConfirmedOrders } from '@/lib/orders.functions'

await repairMissingConfirmedOrders()
```

Esto revisa mensajes donde la IA dice "pedido registrado" pero falta en BD, e intenta recuperarlos.

#### 3. Mejoras en el Prompt de IA
Se ha mejorado el sistema prompt para:
- Hacer obligatorio ejecutar `confirm_order` para confirmar pedidos
- Advertencia clara: "NO digas 'pedido registrado' hasta que la herramienta se ejecute"
- Detección de patrones que indican confirmación faltante

---

## 📈 Monitoreo y Debugging

### Ver Solicitudes Fallidas Pendientes
```sql
SELECT 
  id,
  thread_id,
  chat_id,
  original_message,
  retry_count,
  max_retries,
  next_retry_at,
  status,
  created_at
FROM failed_ai_requests
WHERE status = 'pending'
ORDER BY next_retry_at ASC;
```

### Ver Historial de Reintentos
```sql
SELECT 
  id,
  status,
  retry_count,
  created_at,
  updated_at
FROM failed_ai_requests
WHERE org_id = 'tu-org-id'
ORDER BY updated_at DESC
LIMIT 50;
```

### Logs en Consola/Dashboard
- `[callVertexAI]` - Información sobre intentos de Vertex
- `[ai-reply]` - Detalles de errores en respuestas
- `[retry-processor]` - Ejecución de reintentos automáticos

---

## ✨ Características Adicionales

### Auto-limpieza
Solicitudes resueltas o falladas más de 1 hora se limpian automáticamente:
```typescript
import { cleanupOldResolvedRequests } from '@/lib/retry-manager.server'
await cleanupOldResolvedRequests()
```

### Detalles Contextuales
Cada solicitud fallida almacena:
- Historial de mensajes completo
- Configuración del provider (para debugging)
- Modelo utilizado
- Información de error completa

---

## 🚀 Próximos Pasos

1. ✅ Ejecutar migración de BD
2. ✅ Configurar cron job (Supabase/Vercel/Externo)
3. ✅ Configurar variable SERVICE_TOKEN (si usar Supabase)
4. ✅ Testear con Vertex deshabilitado (para simular fallos)
5. ✅ Monitorear logs de [retry-processor]
6. ✅ Usar `repairMissingConfirmedOrders` si hay pedidos huérfanos

---

## 🆘 Troubleshooting

### "Widget no aparece en el chat"
- Verificar que SEND_SUPPORT_MESSAGE se inserta correctamente
- Revisar que el mensaje tiene formato: `[SUPPORT_WIDGET:requestId:threadId]`
- Limpiar caché del navegador

### "Reintentos no se ejecutan"
- Verificar que el cron job está configurado
- Revisar logs de [retry-processor]
- Verificar SERVICE_TOKEN si es requerida

### "Pedidos siguen sin registrarse"
- Ejecutar `repairMissingConfirmedOrders` manualmente
- Verificar que `confirm_order` tool está disponible para la IA
- Revisar system prompt - debe incluir la advertencia de confirm_order

---

## 📝 Variables de Entorno

```bash
# Token para proteger endpoint de reintentos
SERVICE_TOKEN=tu-token-secreto-aqui

# Ya existentes (no cambiar)
VERTEX_SERVICE_ACCOUNT_JSON=...
LOVABLE_API_KEY=...
OPENAI_API_KEY=...
GROK_API_KEY=...
```

---

**Última actualización:** 10 de Junio de 2026
**Versión:** 1.0
