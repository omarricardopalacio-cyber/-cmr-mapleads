# 🚨 GUÍA DE EJECUCIÓN DE MIGRACIÓN SUPABASE

**Estado Actual**: Aplicación caída por migración fallida  
**Solución**: Ejecutar la migración SQL correcta en Supabase

---

## ✅ PASO 1: Abrir Supabase SQL Editor

1. Ve a: https://app.supabase.com
2. Selecciona tu proyecto
3. En la barra lateral izquierda, click en **"SQL Editor"**
4. Click en **"New Query"** (botón azul arriba a la derecha)

---

## ✅ PASO 2: Copiar el SQL Correcto

**IMPORTANTE**: 
- ✅ Copia el archivo: `supabase/migrations/20260612230000_saas_admin.sql`
- ❌ NO copies `src/integrations/supabase/client.ts` (esto es TypeScript, no SQL)

**El archivo SQL comienza con**:
```
BEGIN;

CREATE TYPE public.platform_role AS ENUM ('SUPER_ADMIN');
```

**El archivo SQL termina con**:
```
COMMIT;
```

---

## ✅ PASO 3: Ejecutar en Supabase

1. Pega TODO el contenido de `20260612230000_saas_admin.sql` en el editor SQL
2. Click en botón **"Run"** (esquina superior derecha, ícono ▶)
3. **Espera a que complete** - debería tardar 5-10 segundos

---

## ✅ PASO 4: Verificar Ejecución

Deberías ver:
- ✅ Sin errores rojos
- ✅ Mensaje "Success" o similar
- ✅ Línea final muestre "COMMIT;" ejecutado

---

## ✅ PASO 5: Regenerar TypeScript Types (Opcional)

En terminal local, ejecuta:
```bash
supabase gen types typescript > src/integrations/supabase/types.ts
```

---

## ✅ PASO 6: Crear Primer SUPER_ADMIN

En el mismo SQL editor de Supabase, ejecuta:
```sql
INSERT INTO public.platform_roles (user_id, role)
VALUES ('[TU_USER_ID]', 'SUPER_ADMIN');
```

Reemplaza `[TU_USER_ID]` con tu ID real de usuario en auth.users

---

## 🔍 Verificación Final

Después de ejecutar, verifica que estas tablas existan:
- `platform_roles`
- `saas_plans`
- `saas_subscriptions`
- `saas_audit_logs`
- `saas_impersonations`
- `global_settings`

La aplicación debería recuperarse automáticamente después de 30 segundos.

---

## ❌ Si Sale Error

**Error "syntax error at or near /"**:
- ✅ Borraste el contenido anterior de `client.ts`? 
- ✅ Copiaste el archivo `.sql` completo?
- ✅ Sin comentarios TypeScript?

Si sigue fallando:
1. Click en **"Clear"** en el editor
2. Copia todo el archivo `20260612230000_saas_admin.sql` desde cero
3. Ejecuta de nuevo
