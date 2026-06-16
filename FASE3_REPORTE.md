# FASE 3 — RLS estricto + Realtime de config global

## Resumen ejecutivo

Esta fase aplica el aislamiento multi-tenant completo sobre los datos privados y complementa la solución global de configuración con Realtime.

### Entregables
- `docs/migrations/20260614020000_saas_multitenant_phase3.sql`
  - Aplica `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` a tablas privadas.
  - Crea políticas `*_tenant_isolation` para `authenticated`.
  - Usa `org_id = public.current_org_id() OR public.is_super_admin()`.
  - Agrega políticas por `EXISTS(...)` para tablas hijas sin `org_id` propio.
  - Actualiza `global.config_version` al final para invalidar cachés.
- `src/lib/auth-context.tsx`
  - Suscribe el cliente Realtime a `global.config_version`.
  - Despacha `window.dispatchEvent(new CustomEvent('global-config-changed'))`.

## Cobertura
- Tablas privadas con `org_id` directo: aislamiento RLS aplicado.
- Tablas hijas (sin `org_id` propio): políticas basadas en existencia de padre.
- Tablas globales y SaaS-admin no modificadas.

## Validaciones
```sql
-- Como tenant normal: ver solo sus contactos
SELECT count(*) FROM public.contacts;

-- Como tenant normal: insertar con org_id ajeno debe fallar
INSERT INTO public.contacts (org_id, display_name)
VALUES ('00000000-0000-0000-0000-000000000000', 'hack');

-- Como SUPER_ADMIN: ver todo
SELECT count(*) FROM public.contacts;
```

## Nota
Asegúrate de habilitar Realtime para el schema `global` y la tabla `config_version` en Supabase Dashboard → Database → Replication → Source.
