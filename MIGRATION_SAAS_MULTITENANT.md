# Bitácora de Migraciones — SaaS Multi-Tenant
## Proyecto: Maple CRM / Bridge

---

## ✅ FASE 1 — Fundación Multi-Tenant
**Archivo**: `docs/migrations/20260614000000_saas_multitenant_phase1.sql`
**Fecha**: 2026-06-14
**Estado**: ✅ Aplicada

### Qué hace
| Elemento | Descripción |
|---|---|
| `CREATE SCHEMA global` | Schema aislado para configuración compartida |
| `global.config_version` | Tabla singleton (1 fila) con contador de versión |
| `global.bump_config_version()` | Trigger function que incrementa `config_version` |
| `public.current_org_id()` | Función SQL que devuelve el `org_id` del usuario actual |
| `public.is_super_admin()` | Función SQL que verifica si el usuario es SUPER_ADMIN |
| `public.handle_new_user()` | Trigger reescrito: crea workspace propio por usuario |
| `platform_roles` SUPER_ADMIN | Asigna SUPER_ADMIN a `omarricardopalacio@gmail.com` |
| GRANTs sobre `global.*` | Permisos mínimos para `authenticated`, `anon`, `service_role` |

### Archivos backend modificados (Fase 1)
- `src/lib/org-helpers.ts` — `getTemplateOrgId()` y `cloneTemplateAiConfigToOrg()` marcadas DEPRECATED/NO-OP; `ensureUserOrg()` crea workspace propio
- `src/lib/org.functions.ts` — ajustado para no unir usuarios a org maestra

### Validaciones ejecutadas
```sql
SELECT * FROM global.config_version;
-- → {id: true, version: 1, bumped_at: ...}

SELECT u.email, pr.role
FROM auth.users u
JOIN public.platform_roles pr ON pr.user_id = u.id;
-- → omarricardopalacio@gmail.com | SUPER_ADMIN
```

---

## ✅ FASE 2 — Plantilla Global Sincronizada + Datos Privados por Tenant
**Archivo**: `docs/migrations/20260614010000_saas_multitenant_phase2.sql`
**Fecha**: 2026-06-14
**Estado**: ✅ SQL generado y listo para aplicar | ✅ F2.1 Backend swap implementado | ✅ F2.2 Realtime implementado

### Qué hace
| Paso | Descripción |
|---|---|
| Backup defensivo | `backup_premigration.<tabla>` para cada tabla afectada |
| Resolución workspace maestro | Localiza `omarricardopalacio@gmail.com` → obtiene `org_id` |
| `global.<tabla>` | `CREATE TABLE IF NOT EXISTS ... (LIKE public.<tabla> INCLUDING ALL)` |
| `org_id` nullable | `ALTER TABLE global.<tabla> ALTER COLUMN org_id DROP NOT NULL` |
| Copia inicial | `INSERT INTO global.<tabla> SELECT ... WHERE org_id = master` |
| RLS policies | SELECT: `USING (true)` · ALL: `USING (is_super_admin())` |
| GRANTs | SELECT → `authenticated`, `anon`; ALL → `service_role` |
| Trigger bump | `AFTER INSERT/UPDATE/DELETE FOR EACH STATEMENT → bump_config_version()` |
| Vista `public.<tabla>_v` | Columnas dinámicas via `information_schema`; sustituye `org_id` por `current_org_id()` |
| Bump final | Incrementa `global.config_version` para invalidar cachés |

### Tablas migradas a `global.*`
```
ai_configs          → global.ai_configs          + public.ai_configs_v
auto_replies        → global.auto_replies         + public.auto_replies_v
quick_replies       → global.quick_replies        + public.quick_replies_v
flows               → global.flows                + public.flows_v
flow_steps          → global.flow_steps           + public.flow_steps_v
knowledge_sources   → global.knowledge_sources    + public.knowledge_sources_v
order_fields        → global.order_fields         + public.order_fields_v
pipeline_stages     → global.pipeline_stages      + public.pipeline_stages_v
tags                → global.tags                 + public.tags_v
transfer_rules      → global.transfer_rules       + public.transfer_rules_v
```

> **Nota**: Tablas no listadas arriba (`threads`, `messages`, `contacts`, `orders`,
> `products`, etc.) son **datos privados por tenant** y se migran en Fase 3.

### Características clave
- **Idempotente**: `IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `ON CONFLICT DO NOTHING`
- **No-destructivo**: `public.<tabla>` originales intactas hasta F2.1
- **Resiliente**: salta tablas inexistentes con `NOTICE`

### Cómo aplicar
1. Supabase Dashboard → SQL Editor → New Query
2. Pegar el contenido de `docs/migrations/20260614010000_saas_multitenant_phase2.sql`
3. Ejecutar
4. Verificar `NOTICE: ✅ <tabla> → global.<tabla> + public.<tabla>_v` por cada tabla

### Validaciones post-migración
```sql
-- Las vistas existen y devuelven config global con org_id del usuario
SELECT * FROM public.ai_configs_v LIMIT 1;
SELECT * FROM public.auto_replies_v LIMIT 5;

-- La versión incrementó
SELECT * FROM global.config_version;

-- Tenant normal NO puede modificar global.* (error RLS esperado)
INSERT INTO global.ai_configs (id) VALUES (gen_random_uuid());

-- Datos privados intactos
SELECT COUNT(*) FROM public.threads;
```

### Sub-pasos completados

#### F2.1 — Backend swap (lecturas → vistas) ✅ COMPLETADO

**Archivos modificados**:

| Archivo | Cambio |
|---|---|
| `src/lib/ai.functions.ts` | `getAiConfigForOrg` + `testAiReply` → `.from('ai_configs_v')` sin filtro org |
| `src/lib/ai.server.ts` | `getAiConfigFromDb` → `ai_configs_v`; `assign_tag` read → `tags_v`; `order_fields` → `order_fields_v`; `knowledge_sources` → `knowledge_sources_v` |
| `src/lib/automations.functions.ts` | `listAutoReplies` → `auto_replies_v`; `listQuickReplies` → `quick_replies_v`; `listFlows` → `flows_v`; `listFlowSteps` → `flow_steps_v`; `listKnowledgeSources` → `knowledge_sources_v`; `listTransferRules` → `transfer_rules_v` |
| `src/lib/flows.functions.ts` | `listFlows`, `getFlow`, `listFlowSteps`, `duplicateFlow` pasos → vistas `_v` |
| `src/lib/tags.functions.ts` | `listTags` → `tags_v`; verificación de tag en addContactTag → `tags_v` |
| `src/lib/analytics.functions.ts` | `pipeline_stages` → `pipeline_stages_v` |
| `src/lib/crm.functions.ts` | `getPipelineStages` → `pipeline_stages_v` |
| `src/lib/flow-runner.server.ts` | Todas las lecturas de `flow_steps` → `flow_steps_v` |
| `src/lib/flow-trigger.server.ts` | Lecturas de `flows` → `flows_v`; `flow_steps` → `flow_steps_v` |

**Regla aplicada**:
- LECTURAS de config global → vistas `_v` (sin `.eq('org_id', orgId)`)
- ESCRITURAS → siguen en `public.*` por org (upsert/insert/delete intactos)

#### F2.2 — Realtime de config ✅ COMPLETADO

**Archivo modificado**: `src/lib/auth-context.tsx`

Suscripción activa a `postgres_changes` en `global.config_version`. Cuando el super-admin modifica config global, se invalidan automáticamente las queries de: ai, flows, auto_replies, quick_replies, tags, pipeline_stages, knowledge_sources, order_fields, transfer_rules.

---

## ✅ FASE 3 — RLS estricto en tablas privadas + Realtime global
**Estado**: ✅ Aplicada

### Qué incluye
- RLS estricto `*_tenant_isolation` aplicado en tablas privadas con `org_id` directo.
- Políticas adicionales via `EXISTS(...)` para tablas hijas sin `org_id` propio.
- `docs/migrations/20260614020000_saas_multitenant_phase3.sql` creado como script idempotente.
- `src/lib/auth-context.tsx` suscribe a `global.config_version` y despacha `window.dispatchEvent(new CustomEvent('global-config-changed'))`.
- `global.config_version` se incrementa al final para invalidar cachés de clientes conectados.

### Validación recomendada
- Tenant normal solo ve sus datos privados.
- Tenant no puede insertar filas con `org_id` distinto al suyo.
- SUPER_ADMIN sigue viendo y modificando todos los datos.
- Al editar config global, el cliente recibe el evento `global-config-changed`.

---

## Fases Futuras (4-8)
Documentar cuando se inicien.

---

*Última actualización: 2026-06-14 — Fase 3 completada*
