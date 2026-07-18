# Manual de integración del Catálogo con el CRM (Maple)

> **ACTUALIZADO: El CRM ya NO necesita endpoints HTTP propios en el catálogo.**
> Ahora consulta el Supabase del catálogo **directamente por PostgREST** usando
> la publishable (anon) key. Solo se necesitan permisos RLS correctos.

---

## 1. ¿Qué datos necesita el CRM?

El operador ingresa **4 datos** en el CRM → *Integración Catálogo*:

| # | Campo | Ejemplo |
|---|-------|---------|
| ① | URL Supabase del catálogo | `https://leqjedeupuikzjqlfzpx.supabase.co` |
| ② | Publishable Key (anon) | `sb_publishable_fExI6u...` ó `eyJhbGciOi...` |
| ③ | Slug de la bodega | `tv-market` |
| ④ | *(Avanzado)* Tabla tenants | `tenants` (default) |
| ④ | *(Avanzado)* Tabla productos | `master_products` (default) |

> **⚠️ La URL ① es la URL de Supabase** (`xxxx.supabase.co`), **NO** la URL del
> sitio web de catálogo (`sincro3.netlify.app`).

---

## 2. Qué hace el CRM con esos datos

### Al pulsar "Probar conexión"

**Paso 1 — Resolver slug → tenant_id**
```
GET https://{supabase_url}/rest/v1/{tenants_table}
    ?slug=eq.{slug}&select=id,slug,name&limit=1
Headers:
  apikey: {anon_key}
  Authorization: Bearer {anon_key}
```
Espera: un array con exactamente 1 fila. Si devuelve `[]` → el slug no existe o RLS bloquea.

**Paso 2 — Contar productos activos**
```
GET https://{supabase_url}/rest/v1/{products_table}
    ?tenant_id=eq.{tenantId}&is_active=eq.true&select=id&limit=1
Headers:
  apikey: {anon_key}
  Authorization: Bearer {anon_key}
  Prefer: count=exact
  Range-Unit: items
  Range: 0-0
```
Espera: Header `Content-Range: 0-0/287` con el total de productos.

### Al buscar (IA en tiempo real)

```
GET https://{supabase_url}/rest/v1/{products_table}
    ?tenant_id=eq.{tenantId}&is_active=eq.true
    &or=(name.ilike.*{query}*,long_description.ilike.*{query}*)
    &select=id,name,slug,sku,badge,base_price,warehouse_stock,main_image_url,long_description,category_id
    &limit=6
Headers:
  apikey: {anon_key}
  Authorization: Bearer {anon_key}
```

---

## 3. Requisitos mínimos en el Supabase del catálogo

### Tabla `tenants` (o la que configures)

Columnas requeridas:
```sql
id   uuid primary key
slug text unique not null
name text
```

RLS + Grant para anon:
```sql
-- Habilitar RLS (si no está ya)
alter table public.tenants enable row level security;

-- Política de lectura pública
create policy "tenants public read"
  on public.tenants for select
  to anon, authenticated
  using (true);

-- Grant
grant select on public.tenants to anon, authenticated;
```

### Tabla `master_products` (o la que configures)

Columnas que usa el CRM (acepta alias):

| Columna buscada | Alternativa aceptada |
|-----------------|---------------------|
| `id` | — |
| `name` | `title` |
| `long_description` | `description` |
| `base_price` | `price` |
| `warehouse_stock` | `stock` |
| `main_image_url` | `image_url` |
| `tenant_id` | — (obligatoria para filtrar) |
| `is_active` | — (obligatoria para filtrar activos) |
| `slug` | — (opcional, para URL del producto) |
| `sku` | — (opcional) |
| `badge` | — (opcional) |

RLS + Grant:
```sql
alter table public.master_products enable row level security;

create policy "master_products public read active"
  on public.master_products for select
  to anon, authenticated
  using (is_active = true);

grant select on public.master_products to anon, authenticated;
```

### Índices recomendados (rendimiento)

```sql
create index if not exists idx_mp_tenant_active
  on public.master_products(tenant_id) where is_active = true;

create index if not exists idx_tenants_slug
  on public.tenants(slug);
```

---

## 4. SQL de migración completo (pega en Supabase SQL Editor del catálogo)

```sql
-- ============================================================
-- CRM Catalog Integration Access — aplica en el Supabase del catálogo
-- ============================================================

-- 1. Grants directos para anon
grant select on public.tenants         to anon, authenticated;
grant select on public.master_products to anon, authenticated;

-- 2. RLS en tenants
alter table public.tenants enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'tenants' and policyname = 'tenants public read'
  ) then
    create policy "tenants public read"
      on public.tenants for select
      to anon, authenticated
      using (true);
  end if;
end $$;

-- 3. RLS en master_products
alter table public.master_products enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'master_products' and policyname = 'master_products public read active'
  ) then
    create policy "master_products public read active"
      on public.master_products for select
      to anon, authenticated
      using (is_active = true);
  end if;
end $$;

-- 4. Índices de rendimiento
create index if not exists idx_mp_tenant_active
  on public.master_products(tenant_id) where is_active = true;

create index if not exists idx_tenants_slug
  on public.tenants(slug);
```

---

## 5. Verificación con curl

```bash
# Variables
SUPA_URL="https://leqjedeupuikzjqlfzpx.supabase.co"
ANON_KEY="tu-anon-key"
SLUG="tv-market"

# Test 1: resolver slug
curl "$SUPA_URL/rest/v1/tenants?slug=eq.$SLUG&select=id,slug,name" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
# Debe devolver: [{"id":"uuid...","slug":"tv-market","name":"..."}]

# Test 2: contar productos (necesitas el tenant_id del test 1)
TENANT_ID="pega-el-uuid-del-test-1"
curl "$SUPA_URL/rest/v1/master_products?tenant_id=eq.$TENANT_ID&is_active=eq.true&select=id&limit=1" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Prefer: count=exact" \
  -H "Range-Unit: items" \
  -H "Range: 0-0" \
  -I
# Debe devolver header: content-range: 0-0/287

# Test 3: búsqueda de productos
curl "$SUPA_URL/rest/v1/master_products?tenant_id=eq.$TENANT_ID&is_active=eq.true&or=(name.ilike.*television*,long_description.ilike.*television*)&select=id,name,base_price,warehouse_stock&limit=3" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
```

---

## 6. Flujo completo

```
[Plataforma catálogo Supabase]
  └─ tabla: tenants (slug → id)
  └─ tabla: master_products (tenant_id, is_active, name, base_price...)
          ↑
     PostgREST (anon key)
          ↓
[CRM — catalog.server.ts]
  resolveTenantId() → cachea tenant_id
  searchCatalog()   → ilike query
  getCatalogProduct() → by id
          ↓
[IA del CRM — ai.server.ts]
  tool: search_catalog         → llama searchCatalog()
  tool: send_product_to_customer → llama getCatalogProduct() + engine_commands
          ↓
[WhatsApp cliente]
  imagen + precio + descripción
```

---

## 7. Checklist para el equipo del catálogo

- [ ] Aplicar el SQL de la sección 4 en el SQL Editor de Supabase del catálogo
- [ ] Verificar con los curls de la sección 5
- [ ] Entregar al operador del CRM:
  - URL Supabase (`https://xxxx.supabase.co`)
  - Publishable (anon) Key
  - Slug de la bodega
- [ ] El operador ingresa los datos en el CRM → *Integración Catálogo* → Guardar → Probar
- [ ] Con estado **Conectado** (punto verde) la IA ya puede vender productos reales
