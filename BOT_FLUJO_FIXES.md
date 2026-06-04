# Reporte — Fix del flujo del bot (imágenes, características, productos)
## 1. Diagnóstico
Observaciones desde las capturas:
- Cliente: "tienes zapatero?" → Bot responde con 4 productos pero **sin características, sin imagen y con precios inventados** (sólo nombre y precio desde la `knowledge_base` estática).
- Cliente: "quiero ver las fotos" → Bot: *"Disculpa, parece que hay un problema con los códigos de producto y no puedo enviarte las fotos."*
- Cliente: "medidas, tamaños, características" → Bot: *"Puedes encontrar más detalles en el enlace que te envié."* (nunca envió enlace).

Causa raíz (verificada en código):
1. `src/routes/api/public/engine/ingest.ts → maybeAiReply()` llamaba a `generateReply()` (función legacy **sin herramientas**). El modelo no tenía manera de consultar el catálogo ni de enviar media.
2. `runAiAgent()` (que sí soporta tool calling) **no se invocaba en ningún lado** y sólo exponía 3 tools de CRM (`assign_tag`, `create_reminder`, `transfer_to_human`). No existía `search_products` ni `send_product_image` / `send_product_video`.
3. La sincronización (`syncCatalog`) ya guardaba `image_url`, pero **no guardaba `video_url`** y `searchCatalogProducts` no lo devolvía.
4. La única "fuente de catálogo" para el modelo era el campo `knowledge_base` (texto plano) del `ai_configs`. Por eso inventaba características.

## 2. Cambios aplicados en este CRM
### 2.1. Migración SQL nueva
`docs/migrations/20260604_products_video_url.sql` (ejecutar manual en SQL Editor de Lovable Cloud):
```sql
alter table public.products
  add column if not exists video_url text;
```

### 2.2. `src/lib/catalog.functions.ts`
- `syncCatalog`: el mapeador ahora extrae `video_url` desde el catálogo remoto probando estos campos en orden: `main_video_url`, `video_url`, `videos[0].url`. También añade `cover_url` como fallback de imagen.
- `searchCatalogProducts`: incluye `video_url` en el `select`.

### 2.3. `src/lib/ai.server.ts`
Tools añadidos a `CRM_TOOLS`:
| Tool | Argumentos | Qué hace |
|---|---|---|
| `search_products` | `query`, `limit` (1-5) | Busca en `public.products` por `ilike name`. Si no hay match, devuelve alternativos. Retorna `{found, products:[{id,name,price,stock,description,has_image,has_video,badge}]}`. |
| `send_product_image` | `product_id`, `caption?` | Inserta una fila en `messages` (echo en el CRM) y encola un `engine_commands` tipo `SEND_MESSAGE` con `mediaUrl` + `mimeType:image/jpeg` + `caption`. |
| `send_product_video` | `product_id`, `caption?` | Igual que el anterior pero con `mimeType:video/mp4` y `video_url`. Devuelve mensaje claro si el producto no tiene video. |

Helper nuevo `queueOutgoingMedia(ctx, kind, mediaUrl, caption)` que centraliza el INSERT en `messages` + `engine_commands`. La extensión de WhatsApp ya consume ese tipo de comandos.

`runAiAgent` ahora:
- Acepta `sessionId` y `chatId` además de `threadId`/`contactId`.
- Hace bucle multi-turno (máx 4) para soportar: *search → send_image → preguntar → send_video*.
- Inyecta un `PRODUCT_FLOW_GUIDE` en el system prompt que obliga al modelo a:
  1. Llamar `search_products` **antes** de hablar de cualquier producto.
  2. Mostrar 3-5 productos con nombre, precio y una línea de características.
  3. Llamar `send_product_image` apenas el cliente diga "foto"/"ver" y luego preguntar por el video.
  4. Llamar `send_product_video` si lo piden, o informar claramente cuando `has_video=false`.
  5. Nunca decir "no puedo enviar imágenes".
`executeToolCall` se refactorizó para recibir un objeto `AgentContext` (con sessionId/chatId) en vez de parámetros sueltos.

### 2.4. `src/routes/api/public/engine/ingest.ts`
`maybeAiReply` ahora llama a `runAiAgent` (no a `generateReply`) y le pasa `sessionId`, `chatId`, `contactId`, `threadId`. El texto final del modelo se sigue encolando como `engine_commands` tipo `send_message`. Las imágenes / videos se encolan **desde el tool** durante el mismo turno.

## 3. Pasos para terminar de activarlo
1. **Aplicar migraciones SQL** en SQL Editor (en orden):
   - `docs/migrations/20260604_catalog_integrations.sql` (si no se aplicó ya)
   - `docs/migrations/20260604_products_video_url.sql`
2. **Crear/Editar la integración** en `/catalog-integrations` con:
   - URL: `https://sincro3.netlify.app` *(realmente la URL del Supabase remoto; ver §4)*
   - Slug: `tv-market`
3. Pulsar **Probar conexión** → debe responder `ok:true` con `productCount`.
4. Pulsar **Sincronizar** → revisa `catalog_sync_logs`.
5. En `/ai-config`: dejar `enabled=true`. Ya **no es necesario** pegar todo el catálogo en `knowledge_base`; deja solo políticas (horarios, despacho, tono).
6. Probar desde WhatsApp: `"tienes zapatero?"` → debe mostrar 3-5 productos. `"quiero ver la foto"` → llega la imagen real. `"y el video?"` → llega video si existe.

## 4. Qué necesita la **plataforma del catálogo** (sincro3 / espejo)
Para que CUALQUIER catálogo Supabase se conecte sin tocar el CRM:

### 4.1. Datos a entregar al CRM
| Campo | Ejemplo | Notas |
|---|---|---|
| `supabaseUrl` | `https://xxxxx.supabase.co` | URL del **proyecto Supabase**, NO la del Netlify. Sacar de Supabase → Project Settings → API. |
| `publishableKey` | `eyJhbGciOi...` (anon/publishable) | Nunca el `service_role`. |
| `slug` | `tv-market` | Slug del tenant/bodega. |
| `tenantsTable` | `tenants` | Default. Solo cambiar si tu tabla se llama distinto. |
| `productsTable` | `master_products` | Idem. |

### 4.2. Esquema mínimo esperado en el proyecto del catálogo
```sql
-- tabla de tenants
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text
);

-- tabla de productos
create table if not exists public.master_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sku text,
  slug text,
  name text not null,            -- ó "title"
  description text,              -- ó "long_description"
  base_price numeric(12,2),      -- ó "price"
  warehouse_stock integer,       -- ó "stock"
  main_image_url text,           -- ó "image_url" / "cover_url"
  main_video_url text,           -- ó "video_url" / videos jsonb[]
  badge text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create index if not exists idx_mp_tenant on public.master_products(tenant_id, is_active);
```

### 4.3. Políticas RLS — LECTURA pública con el anon key
```sql
alter table public.tenants enable row level security;
alter table public.master_products enable row level security;

create policy "anon_read_tenants"
  on public.tenants for select to anon using (true);

create policy "anon_read_active_products"
  on public.master_products for select to anon
  using (is_active = true);
```
Sin estas dos políticas la sincronización falla con `permission denied for table tenants/master_products` (es el error real detrás del mensaje genérico del bot).

### 4.4. Validación manual antes de cargar la integración
Desde la terminal:
```bash
curl "https://<PROJECT>.supabase.co/rest/v1/tenants?slug=eq.tv-market&select=id" \
  -H "apikey: <PUBLISHABLE_KEY>"

curl "https://<PROJECT>.supabase.co/rest/v1/master_products?tenant_id=eq.<ID>&select=id&limit=1" \
  -H "apikey: <PUBLISHABLE_KEY>"
```
Ambos deben devolver JSON (no `[]` vacío ni 401).

## 5. Cómo replicar TODO en un proyecto espejo
En el proyecto-espejo (CRM nuevo) repetir EXACTAMENTE estos pasos:
1. Aplicar migraciones (en orden):
   - `docs/migrations/20260604_catalog_integrations.sql`
   - `docs/migrations/20260604_products_video_url.sql`
2. Copiar estos archivos tal cual:
   - `src/lib/catalog.functions.ts`
   - `src/lib/ai.server.ts` (con `runAiAgent`, tools y `PRODUCT_FLOW_GUIDE`)
   - `src/routes/_authenticated.catalog-integrations.tsx`
3. En `src/routes/api/public/engine/ingest.ts` reemplazar la llamada de `generateReply(...)` por:
   ```ts
   const { reply } = await runAiAgent({
     orgId, threadId, contactId, sessionId, chatId,
     messages: [...history, { role: 'user', content: text }],
     cfg: cfg as Record<string, unknown>,
   })
   ```
4. Asegurar que el secreto `LOVABLE_API_KEY` esté disponible.
5. Crear la integración del catálogo en `/catalog-integrations` y sincronizar.

## 6. Archivos tocados en este turno
```
docs/migrations/20260604_products_video_url.sql   (nuevo)
src/lib/ai.server.ts                              (modificado: tools + agent)
src/lib/catalog.functions.ts                      (modificado: video_url)
src/routes/api/public/engine/ingest.ts            (modificado: runAiAgent)
BOT_FLUJO_FIXES.md                                (este reporte)
```
