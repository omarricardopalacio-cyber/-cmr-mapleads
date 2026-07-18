# FASE 4 — Super Admin + Swap IA a global.ai_configs

## 1. Qué se implementó en este proyecto

### 1.1 SQL — docs/migrations/20260614030000_saas_multitenant_phase4.sql

Migración idempotente que asigna `super_admin` a Omar:

```sql
DO $$
DECLARE _uid uuid; _org uuid;
BEGIN
  SELECT id INTO _uid FROM auth.users
   WHERE email = 'omarricardopalacio@gmail.com' LIMIT 1;
  IF _uid IS NULL THEN RETURN; END IF;

  SELECT org_id INTO _org FROM public.user_roles
   WHERE user_id = _uid
   ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
   LIMIT 1;

  INSERT INTO public.user_roles (user_id, org_id, role)
  VALUES (_uid, _org, 'super_admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
```

Reporta `NOTICE` con el conteo total de `super_admins`.

### 1.2 Backend — src/lib/ai.functions.ts

Cambios clave:

- ❌ Eliminado `getTemplateOrgId` y toda la lógica de "template org".
- ➕ Helper `getGlobalAiConfig()` lee una sola fila vía:
  - `supabaseAdmin.schema("global").from("ai_configs").select("*").limit(1).maybeSingle()`
- ➕ Helper `isSuperAdmin(userId)` consulta `user_roles` con `role = 'super_admin'`.
- 🔄 `getAiConfig`: lee desde `global.ai_configs`, devuelve `{ ...row, org_id: userOrgId }` para compatibilidad UI.
- 🔒 `saveAiConfig`: valida `isSuperAdmin()` → si no, `throw Error("Forbidden")`.
  - Hace upsert directo en `global.ai_configs` con `service_role`.
- 🔄 `testAiReply`: usa config global directamente.
- ✅ `toggleContactAi` y `listAiActions` siguen privados por org.

Defensa en profundidad:
- RLS de `global.ai_configs` (Fase 2)
- Check de rol en código
- `service_role` solo dentro del handler

## 2. Receta para proyecto espejo (otra IA)

### Pre-requisitos

- Fases 1, 2, 3 aplicadas
- Schema `global` existe con `global.ai_configs` (1 fila) y `global.config_version`
- `enum app_role` incluye `super_admin`
- `public.is_super_admin(uuid)` y `public.current_org_id()` existen
- Realtime listener `global-config-changed` activo en `auth-context.tsx`

### Paso A — SQL: asignar super_admin

Crear `docs/migrations/<timestamp>_saas_multitenant_phase4.sql` con el bloque DO de la sección 1.1.
Reemplazar el email del usuario maestro por el del proyecto espejo.
Ejecutar en SQL Editor.

Validar:

```sql
SELECT count(*) FROM public.user_roles WHERE role = 'super_admin'; -- ≥ 1
```

### Paso B — Backend swap del módulo IA

Editar `src/lib/ai.functions.ts`:

- Quitar imports de `getTemplateOrgId` / `cloneTemplateAiConfigToOrg` / helpers de "template".
- Agregar helper `isSuperAdmin`.
- Agregar helper `getGlobalAiConfig`.
- Reescribir `getAiConfig` para leer global y mezclar `org_id` del usuario.
- Reescribir `saveAiConfig`:
  - Primera línea del handler: `if (!(await isSuperAdmin(context.userId))) throw new Error("Forbidden")`
  - Usar `supabaseAdmin.schema("global").from("ai_configs")`.
  - Quitar `org_id` del payload.
- Reescribir `testAiReply` para usar `getGlobalAiConfig()`.
- Mantener intactos `toggleContactAi` y `listAiActions`.
- No cambiar la firma de respuesta `{ config, hasVertexSecret }`.

### Paso C — Validación end-to-end

1. Login como `super_admin`, abrir panel IA → carga prompt desde `global.ai_configs`
2. Editar prompt y guardar → persiste, `global.config_version` incrementa
3. Otro tenant abierto en paralelo → recibe `global-config-changed` y refetcha en <3s
4. Login como tenant normal → guardar prompt falla con `Forbidden`
5. `UPDATE global.ai_configs ...` como tenant normal en SQL falla por RLS

### Paso D (opcional, Fase 6) — Gating UI

- Exponer `isSuperAdmin: boolean` desde `auth-context.tsx`
- `disabled={!isSuperAdmin}` en inputs del panel IA
- Mostrar banner "modo lectura"
