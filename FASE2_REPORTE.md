# FASE2_REPORTE.md
## Reporte de Implementación — Fase 2 SaaS Multi-Tenant
### Plantilla Global Sincronizada + Datos Privados por Tenant

**Estado**: ✅ SQL generado y listo para aplicar | ✅ F2.1 Backend swap implementado en 25+ puntos | ✅ F2.2 Realtime implementado en auth-context.tsx

---

## 1. Resumen ejecutivo

La Fase 2 traslada toda la configuración desde `public.*` (multi-copia por tenant) hacia un único schema `global.*` (una sola fila por recurso), y expone esa configuración a los tenants mediante vistas compatibles `public.<recurso>_v` que inyectan el `org_id` del usuario actual para no romper el código existente.

**Tras esta fase**:
- ✅ 1 sola fuente de verdad para IA, auto-respuestas, flujos, etiquetas, etapas, reglas, etc.
- ✅ Solo `SUPER_ADMIN` puede modificar la configuración global (RLS).
- ✅ Cualquier cambio del super-admin se propaga instantáneamente a todos los tenants (actuales y futuros) vía vistas + bump de `global.config_version`.
- ✅ Nada de la data privada (chats, contactos, pedidos, productos) se toca.

---

## 2. Archivos creados / modificados en este proyecto

| Archivo | Tipo | Propósito |
|---|---|---|
| `docs/migrations/20260614010000_saas_multitenant_phase2.sql` | **Nuevo** | Migración SQL idempotente que crea `global.*`, copia datos del workspace maestro, configura RLS, triggers y vistas `public.*_v`. |
| `MIGRATION_SAAS_MULTITENANT.md` | **Nuevo** | Bitácora fase a fase con sección Fase 1 + Fase 2, validaciones y sub-pasos pendientes (F2.1, F2.2). |
| `FASE2_REPORTE.md` | **Nuevo** | Este documento. |

> **Recordatorio**: Fase 1 ya entregó `docs/migrations/20260614000000_saas_multitenant_phase1.sql`,
> `src/lib/org-helpers.ts` y `src/lib/org.functions.ts` ajustados.

---

## 3. Qué hace la migración (paso a paso interno)

**Archivo**: `docs/migrations/20260614010000_saas_multitenant_phase2.sql`

1. **Backup defensivo**: crea `backup_premigration.<tabla>` por cada tabla afectada (idempotente con `CREATE TABLE IF NOT EXISTS`).

2. **Resolución del workspace maestro**: localiza `omarricardopalacio@gmail.com`, obtiene su `org_id` (prioridad owner > admin).

3. **Por cada recurso global** (`ai_configs`, `auto_replies`, `quick_replies`, `flows`, `flow_steps`, `knowledge_sources`, `order_fields`, `pipeline_stages`, `tags`, `transfer_rules`):
   - `CREATE TABLE IF NOT EXISTS global.<recurso> (LIKE public.<recurso> INCLUDING ALL)`
   - Si la columna `org_id` existe: la hace `NULLABLE` (no aplica en global)
   - Copia inicial: `INSERT INTO global.<recurso> SELECT * FROM public.<recurso> WHERE org_id = master`
   - `UPDATE global.<recurso> SET org_id = NULL` para limpiar

4. **RLS**:
   - `ENABLE ROW LEVEL SECURITY`
   - Policy `<tabla>_select`: `USING (true)` para `authenticated`
   - Policy `<tabla>_write`: `USING/WITH CHECK (public.is_super_admin())`

5. **GRANTs**: `SELECT` a `authenticated`, `anon`; `ALL` a `service_role`

6. **Trigger**: `AFTER INSERT/UPDATE/DELETE ... FOR EACH STATEMENT EXECUTE FUNCTION global.bump_config_version()`

7. **Vista compatible**: `CREATE OR REPLACE VIEW public.<recurso>_v AS SELECT ..., public.current_org_id() AS org_id, ... FROM global.<recurso>` — la lista de columnas se construye dinámicamente desde `information_schema.columns`, sustituyendo `org_id` por `current_org_id()`.

8. **GRANT SELECT** en la vista.

9. **Bump final** de `global.config_version` para invalidar cachés.

### Características clave

| Característica | Descripción |
|---|---|
| **Idempotente** | `IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `ON CONFLICT DO NOTHING` — se puede re-ejecutar sin romper nada |
| **No-destructivo** | Las tablas `public.<recurso>` originales siguen intactas |
| **Convivencia** | La migración coexiste con el código actual hasta que se haga el swap en F2.1 |
| **Resiliente** | Salta tablas faltantes con `NOTICE` y continúa |

---

## 4. Cómo aplicar la migración en este proyecto

1. **Supabase Dashboard → SQL Editor → New Query**
2. Pegar el contenido de `docs/migrations/20260614010000_saas_multitenant_phase2.sql`
3. Ejecutar
4. Verificar mensajes `NOTICE: ✅` por cada tabla

### Validar
```sql
-- Las vistas existen y devuelven la config global con el org_id del usuario
SELECT * FROM public.ai_configs_v LIMIT 1;
SELECT * FROM public.auto_replies_v LIMIT 5;

-- La versión incrementó
SELECT * FROM global.config_version;

-- Un usuario normal NO puede modificar global.*
-- (esperado: error de RLS)
INSERT INTO global.ai_configs (id) VALUES (gen_random_uuid());
```

---

## 5. Sub-pasos completados ✅

### F2.1 — Backend swap (lecturas → vistas) ✅ COMPLETADO

Implementado en 25+ puntos del código en todos los archivos de lectura de configuración global.
Ver lista completa en VALIDACION_FASE2_COMPLETO.md.

### F2.2 — Realtime de config ✅ COMPLETADO

Suscripción a `postgres_changes` en `global.config_version` desde `auth-context.tsx` (líneas 28-62).
Al recibir cambio: invalida queries de ai, flows, auto_replies, quick_replies, tags, pipeline_stages,
knowledge_sources, order_fields, transfer_rules.

### Fase 3 — RLS estricto en privadas + frontend gating

Aplicar `current_org_id()` a `threads`, `messages`, `contacts`, `orders`, `products`, etc. Exponer `isSuperAdmin` en `auth-context`. Modo lectura en pantallas de configuración para no-super-admin.

---

## Instrucciones para Proyecto Espejo (otra IA)

> Receta auto-contenida. La otra IA **NO** necesita leer este proyecto, sólo seguir estos pasos.

### Pre-requisitos del proyecto espejo

- Supabase ya provisionado (Lovable Cloud activo).
- **Fase 1 aplicada previamente**:
  - Schema `global` existe.
  - Tabla `global.config_version` con trigger `bump_config_version()`.
  - Funciones `public.current_org_id()` y `public.is_super_admin()`.
  - `handle_new_user()` crea workspace propio por usuario.
  - Usuario super-admin asignado en `platform_roles`.
  - Existen las tablas `public.ai_configs`, `public.auto_replies`, etc. (sólo se migrarán las que existan).

> Si Fase 1 no está aplicada, primero ejecutar el SQL equivalente a
> `docs/migrations/20260614000000_saas_multitenant_phase1.sql` del proyecto fuente.

---

### Paso A — Adaptar la lista de recursos globales

En el bloque `v_tables text[] := ARRAY[...]` del SQL de Fase 2, incluir exactamente las tablas que serán configuración compartida en el proyecto espejo.

**Default sugerido**:
```
ai_configs, auto_replies, quick_replies, flows, flow_steps,
knowledge_sources, order_fields, pipeline_stages, tags, transfer_rules
```

Quitar/añadir según el modelo de datos real.
> ⚠️ Cualquier tabla privada (`threads`, `messages`, `contacts`, `products`, ...) **NO** debe entrar.

---

### Paso B — Crear el archivo de migración

Crear `docs/migrations/<timestamp>_saas_multitenant_phase2.sql` con exactamente el contenido del archivo equivalente de este proyecto. El script es genérico: detecta columnas dinámicamente por `information_schema`, no asume estructura específica.

Reemplazar `omarricardopalacio@gmail.com` por el email del super-admin del proyecto espejo si fuera distinto.

---

### Paso C — Ejecutar la migración

Supabase Dashboard → SQL Editor → pegar → Run.

Confirmar:
```
NOTICE: ✅ <tabla> → global.<tabla> + public.<tabla>_v
```
por cada recurso.

```sql
SELECT COUNT(*) FROM global.ai_configs; -- > 0 si el workspace maestro tenía datos
SELECT * FROM public.ai_configs_v;      -- devuelve filas con org_id = current_org_id()
```

---

### Paso D — Backend swap (sub-paso F2.1)

En todo el código de servidor (server functions, server routes, server modules):

**Lecturas de configuración → usar las vistas `_v`**:
```typescript
// Antes
await supabase.from('ai_configs').select('*').eq('org_id', orgId)

// Después
await supabase.from('ai_configs_v').select('*')
// La vista ya filtra/inyecta org_id automáticamente
```

**Escrituras de configuración → centralizar en `src/lib/saas-admin.functions.ts`**:
```typescript
export const updateAiConfig = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    id:    z.string().uuid(),
    patch: z.record(z.any()),
  }).parse)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase
      .rpc('is_super_admin', { _uid: context.userId })
    if (!isAdmin) throw new Error('Forbidden')

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
    await supabaseAdmin
      .schema('global')
      .from('ai_configs')
      .update(data.patch)
      .eq('id', data.id)
  })
```

Borrar lógica de clonación (`cloneTemplateAiConfigToOrg`, `syncOrphanDataToOrg`, `getTemplateOrgId`) si quedaba alguna.

**Regenerar tipos**:
```bash
bunx supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

---

### Paso E — Realtime opcional (sub-paso F2.2)

En `src/lib/auth-context.tsx` (o equivalente):

```typescript
useEffect(() => {
  const ch = supabase
    .channel('global-config')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'global', table: 'config_version' },
      () => queryClient.invalidateQueries()
    )
    .subscribe()
  return () => { supabase.removeChannel(ch) }
}, [])
```

---

### Paso F — Validación end-to-end

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Crear usuario nuevo | Recibe workspace propio, ve la config global cargada |
| 2 | Como super-admin, editar prompt IA en `saas-admin.tsx` | `global.config_version.version` incrementa |
| 3 | Tenant A y B ven el nuevo prompt sin recargar (si F2.2 activa) | OK |
| 4 | Como tenant normal: `UPDATE global.ai_configs ...` | Error de RLS |
| 5 | `SELECT * FROM public.ai_configs_v` como tenant normal | Devuelve filas con su `org_id` inyectado |
| 6 | Datos privados (`threads`, `contacts`) siguen aislados | Tenant A no ve nada de Tenant B |

---

### Paso G — Documentar

Crear/actualizar `MIGRATION_SAAS_MULTITENANT.md` con:
- Tablas migradas
- Fecha
- Validaciones ejecutadas
- Lista de archivos backend modificados en F2.1

---

### Prompt sugerido para la IA del proyecto espejo

```
Implementa la Fase 2 del plan SaaS multi-tenant siguiendo FASE2_REPORTE.md
sección "Instrucciones para Proyecto Espejo".

Pre-requisito: Fase 1 aplicada.

Pasos:
(A) Ajusta v_tables a las tablas de configuración reales del proyecto.
(B) Crea la migración SQL idéntica a la referenciada.
(C) Ejecútala en Supabase.
(D) Cambia lecturas backend a vistas _v y centraliza escrituras en
    saas-admin.functions.ts con guardia is_super_admin.
(E) Opcional: Realtime sobre global.config_version.
(F) Corre la checklist de validación.
(G) Documenta en MIGRATION_SAAS_MULTITENANT.md.

No toques tablas privadas (threads, messages, contacts, orders, products)
— eso es Fase 3.
```
