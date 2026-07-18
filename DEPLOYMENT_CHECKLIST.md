# ✅ Checklist de Implementación

## Antes de Iniciar
- [ ] Copia de seguridad de BD realizada
- [ ] Acceso a Supabase disponible
- [ ] Acceso a variables de entorno

---

## Paso 1: Ejecutar Migración SQL ⚡

### En Supabase Console:
1. [ ] Ir a `SQL Editor`
2. [ ] Crear nueva query
3. [ ] Copiar contenido de:
   ```
   supabase/migrations/20260610_failed_ai_requests.sql
   ```
4. [ ] Ejecutar
5. [ ] Verificar que tabla `failed_ai_requests` fue creada:
   ```sql
   SELECT * FROM failed_ai_requests LIMIT 1;
   ```

---

## Paso 2: Deploy de Código 🚀

### Opción A: Git Push (Recomendado)
```bash
cd plan-maestro-crm
git add .
git commit -m "feat: Sistema de reintentos mejorado (7 intentos + widget apoyo)"
git push origin main
```

### Opción B: Manual (Si no anda el deploy automático)
Archivos clave a verificar en servidor:
- [ ] `src/lib/retry-manager.server.ts` ✅ Nuevo
- [ ] `src/lib/ai.server.ts` ✅ Modificado (7 reintentos)
- [ ] `src/routes/api/public/engine/ingest.ts` ✅ Modificado
- [ ] `src/routes/api/public/engine/retry-processor.ts` ✅ Nuevo
- [ ] `src/routes/api/admin/engine/failed-requests.ts` ✅ Nuevo
- [ ] `src/components/support-widget.tsx` ✅ Nuevo
- [ ] `src/routes/_authenticated.conversations.$threadId.tsx` ✅ Modificado

---

## Paso 3: Configurar Cron Job ⏰

### Elegir UNA de las opciones:

#### ✅ Opción A: Supabase (SIN COSTO EXTRA)
```sql
-- Ejecutar en SQL Editor de Supabase

-- 1. Habilitar pg_cron (si no está habilitado)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Crear schedule
SELECT cron.schedule(
  'process-ai-retries',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url:='https://plan-maestro-bridge.lovable.app/api/public/engine/retry-processor',
      headers:='{"Content-Type": "application/json", "x-service-token": "tu-token-secreto-aqui"}'::jsonb,
      body:='{"trigger":"cron"}'::jsonb
    ) as request_id;
  $$
);

-- 3. Verificar que se creó
SELECT * FROM cron.job WHERE jobname = 'process-ai-retries';
```

#### ✅ Opción B: Vercel Crons
1. [ ] Ir a proyecto en Vercel
2. [ ] Settings → Crons
3. [ ] Crear nuevo cron:
   ```json
   {
     "path": "/api/public/engine/retry-processor",
     "schedule": "*/5 * * * *"
   }
   ```
4. [ ] Guardar

#### ✅ Opción C: EasyCron (Externo)
1. [ ] Ir a https://www.easycron.com
2. [ ] Crear nueva tarea cron:
   - URL: `https://tu-dominio.com/api/public/engine/retry-processor`
   - Método: POST
   - Headers:
     ```
     Content-Type: application/json
     x-service-token: tu-token-secreto
     ```
   - Frecuencia: `*/5 * * * *` (cada 5 minutos)
3. [ ] Probar ejecución manual

#### ✅ Opción D: UptimeRobot
1. [ ] Ir a https://uptimerobot.com
2. [ ] Crear monitor (API/Webhook):
   - URL: `https://tu-dominio.com/api/public/engine/retry-processor`
   - Request type: POST
   - Headers: `x-service-token: tu-token-secreto`
   - Interval: 5 minutos
3. [ ] Activar

---

## Paso 4: Configurar Variables de Entorno 🔐

### En tu servidor/Vercel/servidor local:

```bash
# Agregar variable (crear si no existe):
SERVICE_TOKEN=tu-token-secreto-aleatorio-aqui

# Generar token seguro (ejecutar en terminal):
# macOS/Linux:
openssl rand -base64 32

# Windows PowerShell:
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((New-Guid).ToString())) -Replace '=+$'
```

### En Supabase Console (si usas Supabase cron):
Este token debe coincidir con el usado en la query de Supabase.

---

## Paso 5: Verificación y Testing 🧪

### Test 1: Verificar que tabla existe
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'failed_ai_requests';
```

### Test 2: Simular fallo de Vertex (Opcional)
1. [ ] En `src/lib/ai.server.ts`, cambiar línea de test:
   ```typescript
   // Temporalmente, en la función callVertexAI:
   if (process.env.FORCE_VERTEX_FAIL === 'true') {
     throw new Error('Vertex forced failure for testing');
   }
   ```
2. [ ] Setear variable: `FORCE_VERTEX_FAIL=true`
3. [ ] Enviar mensaje al chat → Debería ver widget de apoyo
4. [ ] Verificar que registro se creó en BD
5. [ ] Esperar 5 minutos → Debería ejecutarse cron job
6. [ ] Remover variable y revertir cambio

### Test 3: Verificar widget de apoyo
1. [ ] Abrir chat
2. [ ] Si hay mensaje con `[SUPPORT_WIDGET:`, debe mostrar widget naranja
3. [ ] Timer debe funcionar
4. [ ] Botón de asesor debe ser clickeable

### Test 4: Verificar API de admin
```bash
# Listar solicitudes fallidas:
curl -X GET 'https://tu-dominio.com/api/admin/engine/failed-requests?status=pending' \
  -H 'Authorization: Bearer tu-token-jwt'

# Forzar reintento:
curl -X POST 'https://tu-dominio.com/api/admin/engine/failed-requests' \
  -H 'Authorization: Bearer tu-token-jwt' \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"uuid-aqui","forceReset":true}'
```

---

## Paso 6: Monitoreo Inicial 📊

### En Primera Semana:
- [ ] Revisar logs de [callVertexAI]
- [ ] Revisar logs de [retry-processor]
- [ ] Contar solicitudes en failed_ai_requests
  ```sql
  SELECT COUNT(*) FROM failed_ai_requests WHERE created_at > NOW() - INTERVAL '24 hours';
  ```
- [ ] Verificar tasa de éxito:
  ```sql
  SELECT 
    status, 
    COUNT(*) as count 
  FROM failed_ai_requests 
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY status;
  ```

### En Primera Semana - Esperado:
| Status | Esperado |
|--------|----------|
| resolved | 85-95% |
| pending | 0-5% (esperando reintento) |
| failed | 5-10% |

---

## Paso 7: Documentación y Capacitación 📚

- [ ] Compartir `RETRY_SYSTEM_SETUP.md` con el equipo
- [ ] Compartir `IMPLEMENTATION_SUMMARY.md` con el equipo
- [ ] Mostrar cómo acceder a panel de admin:
  ```
  /api/admin/engine/failed-requests (GET)
  ```
- [ ] Documentar escalation process si más del 20% falla

---

## Solución de Problemas 🔧

### "¿El widget no aparece?"
- [ ] Verificar que el mensaje empieza con `[SUPPORT_WIDGET:`
- [ ] Limpiar caché del navegador (Ctrl+Shift+Del)
- [ ] Verificar que SupportWidget está importado
- [ ] Revisar console del navegador (F12)

### "¿El cron no ejecuta?"
- [ ] Verificar que cron está configurado
- [ ] Revisar logs del servidor
- [ ] Probar URL manualmente con curl
- [ ] Verificar SERVICE_TOKEN si está usando Supabase

### "¿Los pedidos siguen sin registrarse?"
- [ ] Ejecutar `repairMissingConfirmedOrders()`
  ```typescript
  import { repairMissingConfirmedOrders } from '@/lib/orders.functions'
  const result = await repairMissingConfirmedOrders()
  console.log(`Reparados: ${result.repaired}`)
  ```
- [ ] Verificar que `confirm_order` tool está disponible
- [ ] Revisar system prompt de IA

---

## Rollback (Si algo falla) ↩️

```bash
# Revertir cambios:
git revert HEAD~1
git push origin main

# Si fue deploy manual, revertir archivo por archivo:
# - Restaurar versión anterior de ai.server.ts
# - Eliminar archivos nuevos
# - Redeploy
```

Eliminar tabla (PELIGRO - solo si algo está muy mal):
```sql
DROP TABLE IF EXISTS failed_ai_requests;
```

---

## ✨ Próximos Pasos (Después de Exitoso Deploy)

- [ ] Monitor mensual de fallos
- [ ] Optimización de tiempos de reintento basada en datos
- [ ] Dashboard visual para admins
- [ ] Notificaciones de Slack/Email cuando hay muchos fallos
- [ ] A/B testing de mensajes de reintentos

---

## 📞 Soporte

Si encontras problemas:
1. Revisar logs con `[retry-processor]`
2. Verificar BD con queries SQL
3. Revisar console del navegador (F12)
4. Ejecutar tests (paso 5)
5. Si persiste, contactar soporte

---

**Fecha:** 10 Junio 2026  
**Versión:** 1.0  
**Estimado de tiempo:** 15-30 minutos (incluyendo testing)
