# Migración SaaS Multi-Tenant — Guía Completa (Fases 1 → 6)

> Documento auto-contenido para replicar la migración en un proyecto espejo.
> **Estado:** 100% implementado. Todas las fases validadas.

---

## 1. Arquitectura objetivo

```
┌─────────────────────────────────────────────┐
│  SCHEMA: global                             │
│  - Configuración compartida (1 fila/recurso) │
│  - Solo SUPER_ADMIN escribe                  │
│  - Todos los tenants LEEN                    │
│  - Triggers bump de config_version           │
└─────────────────────────────────────────────┘
              ▼ vistas public.*_v (Fase 2)
┌─────────────────────────────────────────────┐
│  SCHEMA: public                             │
│  - Datos privados por tenant (RLS org_id)   │
│  - threads, messages, contacts, orders, ... │
│  - flow_runs (ejecución) sigue aquí         │
└─────────────────────────────────────────────┘
```

**Principios:**
- **Configuración global, datos privados.** Todo recurso editable por un admin maestro vive en `global.*`.
- **RLS en dos capas.** `global.*`: SELECT abierto, ALL = `is_super_admin()`. `public.*`: `org_id = current_org_id()`.
- **Defensa en profundidad.** El backend rechaza mutaciones con `assertSuperAdmin`; la UI oculta botones para no-super-admin (Fase 6).
- **Sin clonación.** Nuevos usuarios crean workspace propio; nunca se copian datos de otro tenant.

---

## 2. Pre-requisitos del proyecto espejo

1. Supabase provisionado (Lovable Cloud).
2. Tablas `public.*` ya creadas: `ai_configs`, `auto_replies`, `auto_reply_steps`, `quick_replies`, `flows`, `flow_steps`, `flow_templates`, `knowledge_sources`, `tags`, `pipeline_stages`, `order_fields`, `transfer_rules`.
3. Tablas privadas: `contacts`, `threads`, `messages`, `orders`, `products`, `broadcasts`, `flow_runs`, `contact_tags`, etc.
4. TanStack Start + React + Supabase client (browser + admin).
5. Email del usuario que será SUPER_ADMIN.

---

## 3. Fase 1 — Fundación (SQL + org helpers)

### SQL: `docs/migrations/<ts>_saas_multitenant_phase1.sql`

```sql
-- 1. Schema global + config_version singleton
CREATE SCHEMA IF NOT EXISTS global;
CREATE TABLE IF NOT EXISTS global.config_version (
  id boolean PRIMARY KEY DEFAULT true,
  version bigint DEFAULT 1,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  CONSTRAINT config_version_single CHECK (id = true)
);

-- 2. Trigger para bump automático de versión
CREATE OR REPLACE FUNCTION global.bump_config_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO global.config_version (id, version, updated_at)
  VALUES (true, 1, now())
  ON CONFLICT (id)
  DO UPDATE SET version = global.config_version.version + 1, updated_at = now();
  RETURN NULL;
END;
$$;

-- 3. Helper current_org_id()
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'owner' THEN 1
    WHEN 'admin' THEN 2
    ELSE 3
  END LIMIT 1;
$$;

-- 4. Helper is_super_admin()
CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_roles
    WHERE user_id = _uid AND role = 'SUPER_ADMIN'
  );
$$;

-- 5. handle_new_user reescrito (workspace propio)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id uuid;
BEGIN
  INSERT INTO public.organizations (name)
  VALUES (COALESCE(new.raw_user_meta_data->>'full_name', new.email) || '''s Workspace')
  RETURNING id INTO v_org_id;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name');

  INSERT INTO public.user_roles (user_id, org_id, role)
  VALUES (new.id, v_org_id, 'owner');

  RETURN new;
END;
$$;

-- 6. Asignar SUPER_ADMIN al usuario maestro
INSERT INTO public.platform_roles (user_id, role)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'SUPER_ADMIN_EMAIL'),
  'SUPER_ADMIN'
)
ON CONFLICT (user_id, role) DO NOTHING;
```

### Código: org helpers
- `src/lib/org-helpers.ts`: eliminar `cloneTemplateAiConfigToOrg`, `syncOrphanDataToOrg`, `getTemplateOrgId`. `ensureUserOrg` crea workspace propio.
- `src/lib/org.functions.ts`: `ensureOrg` crea siempre workspace propio.

### Validación
- Nuevo signup → workspace propio, vacío.
- `SELECT public.is_super_admin((SELECT id FROM auth.users WHERE email='...'))` → `true`.
- `SELECT version FROM global.config_version` → `1`.

---

## 4. Fase 2 — Tablas globales + vistas `_v`

### SQL: `docs/migrations/<ts>_saas_multitenant_phase2.sql`

Script genérico e idempotente. Para cada recurso de configuración:

```sql
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'ai_configs','auto_replies','quick_replies','flows','flow_steps',
    'knowledge_sources','order_fields','pipeline_stages','tags','transfer_rules'
  ];
  t text;
  master_org_id uuid;
BEGIN
  SELECT o.id INTO master_org_id
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  JOIN public.organizations o ON o.id = ur.org_id
  WHERE u.email = 'SUPER_ADMIN_EMAIL'
  ORDER BY CASE ur.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END
  LIMIT 1;

  FOREACH t IN ARRAY v_tables LOOP
    -- Backup defensivo
    EXECUTE format('CREATE TABLE IF NOT EXISTS backup_premigration.%I (LIKE public.%I INCLUDING ALL)', t, t);

    -- Crear global
    EXECUTE format('CREATE TABLE IF NOT EXISTS global.%I (LIKE public.%I INCLUDING ALL)', t, t);
    EXECUTE format('ALTER TABLE global.%I ALTER COLUMN org_id DROP NOT NULL', t);

    -- Copiar del master y limpiar org_id
    EXECUTE format('INSERT INTO global.%I SELECT * FROM public.%I WHERE org_id = %L ON CONFLICT DO NOTHING', t, t, master_org_id);
    EXECUTE format('UPDATE global.%I SET org_id = NULL', t);

    -- RLS
    EXECUTE format('ALTER TABLE global.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON global.%I', t||'_select', t);
    EXECUTE format('CREATE POLICY %I_select ON global.%I FOR SELECT TO authenticated USING (true)', t||'_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON global.%I', t||'_write', t);
    EXECUTE format('CREATE POLICY %I_write ON global.%I FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()))', t||'_write', t);

    -- Grants
    EXECUTE format('GRANT SELECT ON global.%I TO authenticated, anon', t);
    EXECUTE format('GRANT ALL ON global.%I TO service_role', t);

    -- Trigger bump
    EXECUTE format('DROP TRIGGER IF EXISTS bump_cfg_%I ON global.%I', t, t);
    EXECUTE format('CREATE TRIGGER bump_cfg_%I AFTER INSERT OR UPDATE OR DELETE ON global.%I FOR EACH STATEMENT EXECUTE FUNCTION global.bump_config_version()', t, t);

    -- Vista compatible
    EXECUTE format('CREATE OR REPLACE VIEW public.%I_v AS SELECT * FROM global.%I', t, t);
    EXECUTE format('GRANT SELECT ON public.%I_v TO authenticated, anon', t);

    RAISE NOTICE '✅ % → global.% + public.%_v', t, t, t;
  END LOOP;

  UPDATE global.config_version SET version = version + 1;
END;
$$;
```

### Validación
- `SELECT * FROM public.ai_configs_v LIMIT 1` → devuelve fila con `org_id` inyectado.
- Tenant normal: `UPDATE global.ai_configs ...` → RLS violation.

---

## 5. Fase 2.2 — Realtime de config global

### Código: `src/lib/auth-context.tsx` (o provider global)

```ts
useEffect(() => {
  const ch = supabase
    .channel('global-config')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'global', table: 'config_version' },
      () => window.dispatchEvent(new CustomEvent('global-config-changed')))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}, []);
```

Invalidar caches React Query:

```ts
useEffect(() => {
  const onChange = () => queryClient.invalidateQueries();
  window.addEventListener('global-config-changed', onChange);
  return () => window.removeEventListener('global-config-changed', onChange);
}, [queryClient]);
```

> Habilitar Realtime para `global.config_version` en Supabase Dashboard → Database → Replication.

---

## 6. Fase 3 — RLS estricto en tablas privadas

### SQL: `docs/migrations/<ts>_saas_multitenant_phase3.sql`

```sql
DO $$
DECLARE
  private_tables text[] := ARRAY[
    'contacts','threads','orders','leads','notes','reminders',
    'scheduled_messages','broadcasts','wa_sessions','ai_actions_log',
    'failed_ai_requests','no_response_pending','events','media',
    'flow_runs','engine_commands','catalog_integrations',
    'catalog_sync_logs','products','lead_ingest_tokens'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY private_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_tenant_isolation', t);
    EXECUTE format('
      CREATE POLICY %I ON public.%I
      FOR ALL TO authenticated
      USING (org_id = public.current_org_id() OR public.is_super_admin(auth.uid()))
      WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin(auth.uid()))
    ', t||'_tenant_isolation', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    RAISE NOTICE '✅ % tenant_isolation', t;
  END LOOP;
END;
$$;
```

Tablas hijas sin `org_id` propio: política con `EXISTS` sobre el padre (ej. `messages` → `threads`, `contact_tags` → `contacts`, `broadcast_recipients` → `broadcasts`).

### Validación
- Tenant A: `SELECT count(*) FROM public.contacts` → solo sus contactos.
- Tenant A: `INSERT INTO public.contacts (org_id, display_name) VALUES ('uuid-otro','hack')` → RLS violation.
- SUPER_ADMIN ve todo.

---

## 7. Fase 4 — Backend swap IA + SUPER_ADMIN formal

### SQL: asignar `super_admin` a user_roles

```sql
INSERT INTO public.user_roles (user_id, org_id, role)
VALUES (<super_admin_uid>, <super_admin_org>, 'super_admin')
ON CONFLICT (user_id, role) DO NOTHING;
```

### Código: `src/lib/ai.functions.ts`
- `getAiConfig`: lee **una sola fila** desde `global.ai_configs` y la etiqueta con `org_id` del usuario.
- `saveAiConfig`: valida `super_admin` antes de actualizar/insertar en `global.ai_configs`.
- Eliminar `getTemplateOrgId()`.

### Patrón de acceso admin al schema global

```ts
const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
await (supabaseAdmin as any).schema('global').from('ai_configs').update(patch).eq('id', id);
```

---

## 8. Fase 5 — Swap auto_replies / quick_replies / knowledge_sources / transfer_rules

### SQL: `auto_reply_steps` (se había omitido en Fase 2)

```sql
CREATE TABLE IF NOT EXISTS global.auto_reply_steps (LIKE public.auto_reply_steps INCLUDING ALL);
ALTER TABLE global.auto_reply_steps ALTER COLUMN org_id DROP NOT NULL;
-- copiar, limpiar org_id, RLS, grants, trigger bump (igual que Fase 2)
```

### Código: `src/lib/super-admin.server.ts` (helper compartido)

```ts
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function isSuperAdmin(uid: string) {
  const { data } = await supabaseAdmin
    .from("user_roles").select("role")
    .eq("user_id", uid).eq("role", "super_admin" as any).maybeSingle();
  return !!data;
}
export async function assertSuperAdmin(uid: string) {
  if (!(await isSuperAdmin(uid)))
    throw new Error("Forbidden: sólo SUPER_ADMIN puede modificar la configuración global");
}
export const globalDb = () => (supabaseAdmin as any).schema("global");
```

### Código: `src/lib/automations.functions.ts`
Por cada módulo (`auto_replies`, `quick_replies`, `knowledge_sources`, `transfer_rules`):
- **Lectura:** `globalDb().from("X")` sin `.eq("org_id", orgId)`.
- **Escritura:** `await assertSuperAdmin(context.userId)` + `globalDb().from("X").upsert({ ...d, org_id: null })`.
- **Delete:** `assertSuperAdmin` + `.eq("id", id)` (sin `org_id`).

---

## 9. Fase 5.1 — Swap tags / pipeline_stages / order_fields + drop FKs

### SQL: drop FKs cruzadas

```sql
ALTER TABLE public.contact_tags DROP CONSTRAINT IF EXISTS contact_tags_tag_id_fkey;
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_pipeline_stage_id_fkey;
```

### Código
- `src/lib/tags.functions.ts`: swap a `globalDb()`; `addContactTag` valida tag contra `global.tags`.
- `src/lib/crm.functions.ts`: `getPipelineStages` → global; nuevos `upsertPipelineStage` / `deletePipelineStage` gateados.
- `src/lib/analytics.functions.ts`: JOIN nested con `pipeline_stages` → dos queries + merge en código.
- `src/lib/order-fields.functions.ts` (nuevo): `listOrderFields`, `createOrderField`, `deleteOrderField` gateados.
- `src/routes/_authenticated.orders.tsx`: reemplazar escritura directa desde browser por `useServerFn` + server fns.

---

## 10. Fase 5.2 — Engine paths swap (ingest.ts + ai.server.ts)

### Código: `src/routes/api/public/engine/ingest.ts`

```ts
const globalDyn = () => (supabaseAdmin as any).schema('global');
```

- `auto_replies` / `auto_reply_steps`: todas las queries → `globalDyn()`, sin `.eq('org_id', orgId)`.
- Tablas privadas (`auto_reply_triggers`, `no_response_pending`, `engine_commands`, `messages`, `threads`) intactas.

### Código: `src/lib/ai.server.ts`
- `order_fields`, `knowledge_sources` reads → `schema('global')`.
- `assign_tag` (function-call IA): read-only sobre `global.tags`. **Eliminar creación dinámica de tags.**

---

## 11. Fase 5.3 — flows + flow_steps + flow_templates → global

### SQL
- Crear `global.flows`, `global.flow_steps`, `global.flow_templates` (mismo patrón Fase 2).
- Copiar filas del master org. Para `flow_steps`: `WHERE flow_id IN (SELECT id FROM public.flows WHERE org_id = master)`.
- `ALTER TABLE public.flow_runs DROP CONSTRAINT IF EXISTS flow_runs_flow_id_fkey;`
- `ALTER TABLE public.flow_runs DROP CONSTRAINT IF EXISTS flow_runs_current_step_id_fkey;`

### Código
- **Engine:** `ingest.ts`, `flow-trigger.server.ts`, `flow-runner.server.ts` → `globalDyn()` para `flows`/`flow_steps`.
- **CRUD:** `flows.functions.ts`, sección FLOWS de `automations.functions.ts`.
  - Reads: `globalDb()` sin `org_id`.
  - Writes: `assertSuperAdmin` + `org_id: null`.
  - **No cross-schema JOINs:** `listFlowRuns` no usa `flow_steps:current_step_id(...)`; fetch separado + `stepMap`.
  - Reemplazar RPC `delete_flow_step_safe` por delete directo en `global.flow_steps` con `assertSuperAdmin`.
- `flow_runs` permanece en `public` con `.eq('org_id', orgId)`.

---

## 12. Fase 6 — Gating UI super_admin

### Infra

`src/lib/super-admin.functions.ts`:

```ts
export const getIsSuperAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({
    isSuperAdmin: await isSuperAdmin(context.userId),
  }));
```

`src/hooks/use-super-admin.ts`:

```ts
export function useIsSuperAdmin() {
  const fn = useServerFn(getIsSuperAdmin);
  const { data, isLoading } = useQuery({
    queryKey: ["is-super-admin"],
    queryFn: () => fn(),
    staleTime: 5 * 60 * 1000,
  });
  return { isSuperAdmin: !!data?.isSuperAdmin, isLoading };
}
```

`src/components/global-config-banner.tsx`:

```tsx
export function GlobalConfigBanner({ children }: { children?: React.ReactNode }) {
  const { isSuperAdmin, isLoading } = useIsSuperAdmin();
  if (isLoading || isSuperAdmin) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">Configuración global — sólo lectura</p>
        <p className="opacity-80">{children ?? "Esta sección la administra el equipo super_admin. Puedes consultarla, pero las acciones de crear, editar y borrar están deshabilitadas."}</p>
      </div>
    </div>
  );
}
```

### Integración en rutas
En cada ruta de configuración global (`auto-replies`, `flows`, `knowledge`, `transfer-rules`, `quick-replies`, `pipelines`, etc.):

```tsx
const { isSuperAdmin } = useIsSuperAdmin();
// ...
{isSuperAdmin && (
  <Button onClick={() => setEditing(...)}>Nuevo</Button>
)}
<GlobalConfigBanner />
```

Las acciones inline (edit/borrar en cards) pueden seguir visibles — el backend responde `Forbidden`.

---

## 13. Checklist de validación end-to-end

| # | Prueba | Esperado |
|---|---|---|
| 1 | Nuevo usuario se registra | Workspace propio, vacío, sin datos de otros tenants |
| 2 | Tenant A ve contactos | Solo los suyos (RLS) |
| 3 | Tenant A intenta leer contactos de Tenant B | 0 filas |
| 4 | Tenant A abre `/ai-config` | Ve prompt global en read-only |
| 5 | Super_admin edita prompt IA | Persiste en `global.ai_configs`; `config_version` sube |
| 6 | Tenant A recibe keyword de auto_reply global | Responde; `last_triggered_at` se actualiza en `global` |
| 7 | Tenant normal intenta crear tag | UI: botón oculto; backend: `Forbidden` |
| 8 | Super_admin crea flujo + steps | Insert OK en `global.flows/flow_steps` |
| 9 | Tenant recibe mensaje que matchea flujo global | `flow_runs` se crea en `public` con `org_id` del tenant |
| 10 | Engine procesa run | `flow-runner` lee steps desde `global.flow_steps` |
| 11 | Dashboard funnel por pipeline | Conteos correctos por tenant |
| 12 | Bypass por DevTools (reactivar botón y mutar) | Backend `Forbidden`; toast de error |

---

## 14. Prompt sugerido para la IA del proyecto espejo

> "Implementa la migración SaaS multi-tenant completa (Fases 1 → 6) en este proyecto.
>
> **Pre-requisitos:** Supabase activo, tablas `public.*` existentes, TanStack Start, usuario maestro identificado.
>
> **Fase 1:** Crear schema `global`, `config_version`, `bump_config_version()`, `current_org_id()`, `is_super_admin()`, reescribir `handle_new_user()` para workspace propio, asignar SUPER_ADMIN.
>
> **Fase 2:** Script SQL genérico que para cada tabla de configuración (`ai_configs`, `auto_replies`, `quick_replies`, `flows`, `flow_steps`, `knowledge_sources`, `tags`, `pipeline_stages`, `order_fields`, `transfer_rules`) cree `global.<t>`, copie del master org, limpie `org_id`, active RLS (select=true, write=is_super_admin), grants, trigger bump, y vista `public.<t>_v`.
>
> **Fase 2.2:** Realtime listener en `global.config_version` que dispare evento `global-config-changed` para invalidar caches.
>
> **Fase 3:** RLS estricto `tenant_isolation` en todas las tablas privadas (`contacts`, `threads`, `messages`, `orders`, `products`, `broadcasts`, `flow_runs`, etc.) usando `current_org_id()`.
>
> **Fase 4:** Swap del módulo IA a `global.ai_configs` con gate `super_admin`.
>
> **Fase 5:** Crear `src/lib/super-admin.server.ts` con `isSuperAdmin`, `assertSuperAdmin`, `globalDb()`. Swap de `auto_replies`, `auto_reply_steps`, `quick_replies`, `knowledge_sources`, `transfer_rules` a `globalDb()`. SQL para `global.auto_reply_steps`.
>
> **Fase 5.1:** Drop FKs `contact_tags_tag_id_fkey` y `contacts_pipeline_stage_id_fkey`. Swap `tags`, `pipeline_stages`, `order_fields`. Crear `order-fields.functions.ts`. Mover escritura de orders del browser a server fns.
>
> **Fase 5.2:** Swap engine (`ingest.ts`) y AI runner (`ai.server.ts`) a `schema('global')`. Eliminar creación dinámica de tags en `assign_tag`.
>
> **Fase 5.3:** Migrar `flows`, `flow_steps`, `flow_templates` a `global`. Drop FKs cross-schema `flow_runs_flow_id_fkey` y `flow_runs_current_step_id_fkey`. Engine + CRUD con `globalDb()`. Eliminar JOINs cross-schema; usar fetches separados + merge en código.
>
> **Fase 6:** Crear `getIsSuperAdmin` serverFn, hook `useIsSuperAdmin` (staleTime 5min), componente `GlobalConfigBanner`. En cada ruta de config global, ocultar CTAs de creación con `{isSuperAdmin && (...)}` e insertar banner.
>
> Validar con el checklist de 12 casos. Documentar en `MIGRACION_COMPLETA.md`."

---

## 15. Archivos clave del proyecto fuente

| Archivo | Rol |
|---|---|
| `docs/migrations/20260614000000_saas_multitenant_phase1.sql` | Fase 1 |
| `docs/migrations/20260614010000_saas_multitenant_phase2.sql` | Fase 2 |
| `docs/migrations/20260614020000_saas_multitenant_phase3.sql` | Fase 3 |
| `docs/migrations/20260614030000_saas_multitenant_phase4.sql` | Fase 4 |
| `docs/migrations/20260614040000_saas_multitenant_phase5.sql` | Fase 5 |
| `docs/migrations/20260614050000_saas_multitenant_phase5_1.sql` | Fase 5.1 |
| `docs/migrations/20260614060000_saas_multitenant_phase5_3.sql` | Fase 5.3 |
| `src/lib/super-admin.server.ts` | Helper `assertSuperAdmin` / `globalDb()` |
| `src/lib/super-admin.functions.ts` | ServerFn `getIsSuperAdmin` |
| `src/hooks/use-super-admin.ts` | Hook `useIsSuperAdmin` |
| `src/components/global-config-banner.tsx` | Banner read-only |
| `src/lib/ai.functions.ts` | Swap IA (Fase 4) |
| `src/lib/automations.functions.ts` | Swap auto_replies/quick_replies/knowledge/transfer_rules + flows (Fases 5, 5.3) |
| `src/lib/tags.functions.ts` | Swap tags (Fase 5.1) |
| `src/lib/crm.functions.ts` | Swap pipeline_stages (Fase 5.1) |
| `src/lib/order-fields.functions.ts` | Swap order_fields (Fase 5.1) |
| `src/lib/analytics.functions.ts` | Fix JOIN pipeline_stages (Fase 5.1) |
| `src/lib/flows.functions.ts` | Swap flows (Fase 5.3) |
| `src/lib/flow-runner.server.ts` | Swap engine runner (Fases 5.2, 5.3) |
| `src/lib/flow-trigger.server.ts` | Swap flow trigger (Fase 5.3) |
| `src/lib/ai.server.ts` | Swap AI engine reads (Fase 5.2) |
| `src/routes/api/public/engine/ingest.ts` | Swap engine ingest (Fases 5.2, 5.3) |
| `src/lib/auth-context.tsx` | Realtime listener (Fase 2.2) |

---

*Última actualización: 2026-06-14. Migración 100% completa.*
