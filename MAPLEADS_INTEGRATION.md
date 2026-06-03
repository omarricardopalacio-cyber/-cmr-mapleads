# Mapleads → CRM (Integración completa)
Documento técnico y reproducible. Describe la integración entre la **extensión Chrome Mapleads** (scraping de Google Maps) y este CRM (TanStack Start + Lovable Cloud / Supabase). Incluye base de datos, endpoint de ingest, server functions, UI, navegación, integración con Campañas Masivas y empaquetado de la extensión.

---

## 1. Arquitectura

```
Google Maps
   │
   ▼
Extensión Chrome (content/content.js)
   │  state.leads.push(lead)
   ▼
src/core/backendSync.js
   │  POST JSON con header X-Mapleads-Token
   ▼
/api/public/mapleads/ingest          (TanStack server route)
   │  valida token → busca user_id
   │  supabaseAdmin.insert
   ▼
public.leads (RLS por user_id)
   ▲                                  ▲
   │                                  │
UI /mapleads ◄── createServerFn ──┘   │
                                      │
Campañas Masivas ──── audience=mapleads
   │ createBroadcast con audience="mapleads"
   │   → toma leads.phone_normalized (no enviados)
   │   → crea broadcast_recipients
   │   → setea leads.message_sent_at (bloqueo)
```

Principios:
- La extensión **no requiere login**: usa un token de ingest por usuario.
- La service role **nunca** sale del backend. La extensión sólo conoce el token.
- Cada lead queda atado a un `user_id` mediante el token.
- Un lead Mapleads puede recibir **un único mensaje** (bloqueo por `message_sent_at`).

---

## 2. Base de datos

Migración aplicada (ya ejecutada en este proyecto):

```sql
CREATE TABLE public.leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT '',
  phone           text NOT NULL DEFAULT '',
  phone_normalized text,
  address         text,
  city            text,
  zone            text,
  category        text,
  maps_category   text,
  website         text,
  email           text,
  rating          numeric,
  review_count    integer,
  open_status     text,
  has_photos      boolean,
  campaign_name   text,
  source          text DEFAULT 'mapleads',
  raw             jsonb,
  scraped_at      timestamptz DEFAULT now(),
  message_sent_at timestamptz,
  message_broadcast_id uuid,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX leads_user_phone_name_unique
  ON public.leads(user_id, phone_normalized, lower(name))
  WHERE phone_normalized IS NOT NULL;

CREATE TABLE public.lead_ingest_tokens (
  token    text PRIMARY KEY,
  user_id  uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
GRANT SELECT, INSERT, DELETE ON public.lead_ingest_tokens TO authenticated;
GRANT ALL ON public.lead_ingest_tokens TO service_role;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_ingest_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own leads" ON public.leads
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own ingest token" ON public.lead_ingest_tokens
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER leads_updated BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

---

## 3. Endpoint público de ingest

`src/routes/api/public/mapleads/ingest.ts`
- Método: `POST /api/public/mapleads/ingest`
- Header obligatorio: `X-Mapleads-Token: <token>` (o `Authorization: Bearer <token>`).
- Cuerpo: `{ "leads": [ {...}, ... ] }` — entre 1 y 500 leads por lote.
- Flujo:
  1. Lee token de headers → consulta `lead_ingest_tokens` con `supabaseAdmin`.
  2. Valida payload con Zod.
  3. Normaliza teléfono.
  4. Inserta uno por uno; el índice único hace que los duplicados sean silenciados.
  5. Responde `{ inserted, duplicated, total }`. CORS abierto (`OPTIONS` incluido).

---

## 4. Server functions (`src/lib/leads.functions.ts`)

Todas protegidas con `requireSupabaseAuth`:

| Función | Uso |
|---|---|
| `getOrCreateIngestToken` | Crea o devuelve el token del usuario actual. |
| `rotateIngestToken` | Borra el token y genera uno nuevo. |
| `listLeads({ from, to, search, onlyUnsent, limit })` | Devuelve `items`, `total`, `with_phone`, `sent_count`, `filtered_count`. |
| `updateLead({ id, name?, phone?, email?, city? })` | Edita un lead (recalcula `phone_normalized`). |
| `deleteLead({ id })` | Elimina un lead. |
| `getUnsentLeadPhones()` | Devuelve `{ items: [{id, name, phone, phone_normalized}] }` para audiencia Mapleads. |
| `markLeadsSent({ ids, broadcastId? })` | Marca enviados (bloqueo). Disponible para integraciones futuras. |

---

## 5. UI Mapleads (`src/routes/_authenticated.mapleads.tsx`)

- Ruta: `/mapleads`, dentro del layout autenticado.
- Tarjetas de totales: Total, Con teléfono, Enviados, Filtrados.
- Bloque **Extensión Mapleads**:
  - Botón "Descargar extensión arreglada (.zip)" (usa `fetch + Blob`).
  - **Backend URL** (read-only, con botón copiar).
  - **Token de ingest** (read-only, copiar, rotar).
- Filtros: búsqueda libre, rango de fechas, toggle "Solo no enviados".
- Tabla con badge **Enviado / Nuevo**, editar (modal), eliminar.
- Exportar **CSV** con BOM UTF-8.
- Sidebar: nueva sección **Búsqueda de clientes → Mapleads** en `src/routes/_authenticated.tsx`.

---

## 6. Integración con Campañas Masivas

`src/lib/automations.functions.ts` → `createBroadcast`:
- Nuevo input: `audience: "mapleads" | null`.
- Si `audience === "mapleads"`:
  1. Lee de `leads` los registros con `message_sent_at IS NULL` y `phone != ''` del usuario actual.
  2. Construye `wa_ids` con `phone_normalized` (sólo dígitos).
  3. Crea `broadcast` + `broadcast_recipients` con `supabaseAdmin`.
  4. **Inmediatamente** setea `leads.message_sent_at` y `message_broadcast_id` para todos los leads incluidos → así quedan bloqueados y nunca recibirán un segundo mensaje, aunque el envío real sea asíncrono.

`src/routes/_authenticated.broadcasts.tsx`:
- Tercer botón de modo: **Leads Mapleads** (al lado de "Por etiqueta" y "Manual").
- Muestra el contador en vivo de `getUnsentLeadPhones`.
- Al crear, invalida `broadcasts`, `mapleadsUnsent` y `leads` para reflejar inmediatamente los nuevos badges "Enviado" en `/mapleads`.

> Decisión de diseño: el bloqueo se aplica al crear la campaña (no al confirmar entrega) porque garantiza unicidad incluso si el dispatcher reintenta y el usuario crea otra campaña antes de que la primera termine. El campo `message_broadcast_id` permite trazabilidad.

---

## 7. Extensión Chrome (empaquetada en `/public/mapleads-extension.zip`)

Cambios sobre la extensión original:
- `manifest.json`: nombre **Mapleads (Backend Sync)**, versión `2.1.0`, incluye `src/core/backendSync.js` en `content_scripts`.
- `src/core/backendSync.js` (nuevo): expone `MLBackendSync.sendBatch(leads)`; lee `mls_backend_url` y `mls_backend_token` de `chrome.storage.local` y hace `POST` al endpoint.
- `content/content.js`: tras `state.leads.push(lead)` invoca `MLBackendSync.sendBatch([lead])` dentro de `try/catch` silencioso (no bloquea el scraping).
- `sidepanel.html`: nuevo bloque "Conexión al backend" con inputs Backend URL + Token + botón Guardar.
- `sidepanel.js`: handler que persiste ambos valores en `chrome.storage.local`.

### Instalación (usuario final)
1. En el CRM ir a **Búsqueda de clientes → Mapleads**, copiar **Backend URL** y **Token**.
2. Pulsar **Descargar extensión arreglada (.zip)** y descomprimir.
3. `chrome://extensions` → activar "Modo desarrollador" → "Cargar descomprimida".
4. Abrir el panel lateral, pegar Backend URL y Token, **Guardar conexión**.
5. Abrir Google Maps y lanzar la campaña; los leads aparecen en el CRM en vivo.

---

## 8. Cómo replicarlo en otro proyecto (paso a paso para otra IA)

> Aplicable a cualquier proyecto TanStack Start + Lovable Cloud / Supabase.

1. **Aplicar la migración SQL del apartado 2** (tablas + RLS + grants + trigger).
2. **Crear los archivos**:
   - `src/lib/leads.functions.ts` con las 7 server functions del apartado 4.
   - `src/routes/api/public/mapleads/ingest.ts` con el endpoint público del apartado 3.
   - `src/routes/_authenticated.mapleads.tsx` con la UI del apartado 5.
3. **Registrar la navegación** en el layout autenticado: añadir un grupo "Búsqueda de clientes" con un item "Mapleads" apuntando a `/mapleads`.
4. **Modificar `createBroadcast`** en `src/lib/automations.functions.ts`:
   - Añadir `audience: z.enum(["mapleads"]).nullable().optional()` al validador.
   - Antes de la rama `tag_id`, manejar `audience === "mapleads"` (ver apartado 6).
   - Tras insertar `broadcast_recipients`, hacer el `update` sobre `leads` para bloquear.
5. **Actualizar UI de Campañas Masivas** (`_authenticated.broadcasts.tsx`):
   - Añadir `useServerFn(getUnsentLeadPhones)` y su query.
   - Añadir un tercer botón de modo "Leads Mapleads".
   - Mostrar contador en vivo cuando se elige ese modo.
   - Pasar `audience: "mapleads"` al `create({ data: {...} })`.
   - Invalidar `["mapleadsUnsent"]` y `["leads"]` tras crear.
6. **Empaquetar la extensión**:
   - Tomar la extensión original (Manifest V3 de scraping de Google Maps).
   - Crear `src/core/backendSync.js` (módulo IIFE que define `globalThis.MLBackendSync` con `getConfig/setConfig/sendBatch`).
   - Inyectar `MLBackendSync.sendBatch([lead])` justo después del push del lead al estado interno.
   - Añadir bloque de configuración en `sidepanel.html` + handler en `sidepanel.js` para persistir `mls_backend_url` / `mls_backend_token` en `chrome.storage.local`.
   - Re-empacar con `zip -r` y servir en `public/mapleads-extension.zip`.

Verificaciones:
- `POST /api/public/mapleads/ingest` con un token válido inserta filas y devuelve `{ inserted, duplicated, total }`.
- `/mapleads` muestra Backend URL + Token y permite rotar.
- Crear una campaña en modo "Leads Mapleads" genera `broadcast_recipients` y marca `message_sent_at` en los leads usados.
- Reintentar la misma campaña ya no incluye esos leads (quedaron bloqueados).

---

## 9. Seguridad

- Service role sólo en `client.server.ts`, importado únicamente en server routes y server functions.
- Tokens de ingest tienen 64 caracteres hexadecimales (2 × UUID sin guiones), únicos por usuario, rotables.
- RLS por `user_id` en ambas tablas.
- El endpoint público valida con Zod, normaliza teléfonos y descarta duplicados por índice único (no por lógica del cliente).
- CORS abierto sólo en el endpoint de ingest (necesario para la extensión).

---

## 10. Archivos tocados (referencia)

```
supabase/migrations/<timestamp>_mapleads.sql
src/lib/leads.functions.ts                       (nuevo)
src/lib/automations.functions.ts                 (modificado: audience mapleads + bloqueo)
src/routes/api/public/mapleads/ingest.ts         (nuevo)
src/routes/_authenticated.mapleads.tsx           (nuevo)
src/routes/_authenticated.tsx                    (nav "Búsqueda de clientes")
src/routes/_authenticated.broadcasts.tsx         (modo "Leads Mapleads")
public/mapleads-extension.zip                    (extensión empaquetada)
MAPLEADS_INTEGRATION.md                          (este documento)
```
