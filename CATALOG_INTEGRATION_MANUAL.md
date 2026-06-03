# Manual de integración del Catálogo con el CRM (Maple)

Este manual describe **los endpoints HTTP públicos** que el proyecto de catálogo (ej. `https://sincro3.netlify.app/catalogo/<slug>`) debe exponer para que el CRM Maple pueda permitir que su IA busque productos y envíe imágenes, precios y descripciones al cliente por WhatsApp.

Está escrito para que **otra IA pueda implementarlo automáticamente** en el proyecto de catálogo (TanStack Start / Lovable Cloud — mismo stack que Maple).

---

## 1. Contrato general

El CRM llama al catálogo por HTTP. Las URLs siguen este patrón:

```
{BASE_URL}/api/public/catalog/{SLUG}/{ACCIÓN}
```

- `BASE_URL`: dominio de tu catálogo (ej. `https://sincro3.netlify.app`)
- `SLUG`: identificador de la bodega/catálogo tal como aparece en la URL pública (ej. `bodega-central-demo`)
- `ACCIÓN`: `health`, `search`, `product/{id}`

**Autenticación opcional**: si el CRM envía el header `X-Catalog-Token`, valida que coincida con un token previamente compartido (puede guardarse en una tabla `catalog_api_tokens(slug, token)` o en `bodega.api_token`). Si no hay token configurado del lado del catálogo, ignora el header.

Todos los endpoints devuelven `Content-Type: application/json` y deben aceptar `OPTIONS` con CORS abierto:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Catalog-Token
```

---

## 2. Endpoints requeridos

### 2.1 `GET /api/public/catalog/{slug}/health`
Comprobación de que el slug existe y el catálogo está activo.

**Respuesta 200**
```json
{
  "ok": true,
  "slug": "bodega-central-demo",
  "name": "Electro Pepe",
  "products_count": 142
}
```
**Respuesta 404** si el slug no existe:
```json
{
  "ok": false,
  "error": "slug not found"
}
```

### 2.2 `GET /api/public/catalog/{slug}/search?q=&limit=`
Busca productos por palabra clave en `name`, `description`, `category`, `sku`.

Parámetros:
- `q` (string, opcional): texto a buscar. Si va vacío, devuelve los más recientes/destacados.
- `limit` (number, opcional, default 6, máx 20).

**Respuesta 200**
```json
{
  "products": [
    {
      "id": "abc123",
      "name": "Cable HDMI 1.5m Guaya J-8",
      "description": "Cable HDMI macho-macho reforzado de 1,5 metros.",
      "price": 8000,
      "currency": "COP",
      "category": "ELECTRODOMESTICOS",
      "image_url": "https://cdn.tu-catalogo.com/products/abc123-1.jpg",
      "images": [
        "https://cdn.tu-catalogo.com/products/abc123-1.jpg",
        "https://cdn.tu-catalogo.com/products/abc123-2.jpg"
      ],
      "video_url": null,
      "stock": 25,
      "url": "https://sincro3.netlify.app/catalogo/bodega-central-demo/p/abc123",
      "attributes": {
        "marca": "Guaya",
        "color": "negro"
      }
    }
  ]
}
```
Campos mínimos obligatorios: `id`, `name`. Todos los demás son opcionales pero recomendados — la IA los usará para componer el mensaje al cliente.

### 2.3 `GET /api/public/catalog/{slug}/product/{id}`
Devuelve la ficha completa de un producto.

**Respuesta 200**
```json
{
  "product": { ...mismo shape que en search... }
}
```
**Respuesta 404**
```json
{
  "product": null
}
```

---

## 3. Implementación recomendada (TanStack Start)

Crea estos archivos en el proyecto de catálogo:

### `src/routes/api/public/catalog/$slug/health.ts`
```typescript
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Catalog-Token",
};

export const Route = createFileRoute("/api/public/catalog/$slug/health")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ params }) => {
        const slug = params.slug;
        const { data: bodega } = await supabaseAdmin
          .from("bodegas")
          .select("id, name")
          .eq("slug", slug)
          .maybeSingle();

        if (!bodega) {
          return Response.json(
            { ok: false, error: "slug not found" },
            { status: 404, headers: CORS },
          );
        }

        const { count } = await supabaseAdmin
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("bodega_id", bodega.id);

        return Response.json(
          { ok: true, slug, name: bodega.name, products_count: count ?? 0 },
          { headers: CORS },
        );
      },
    },
  },
});
```

### `src/routes/api/public/catalog/$slug/search.ts`
```typescript
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CORS = {
  /* mismo bloque que arriba */
};

function mapProduct(row: any, slug: string) {
  const baseUrl = process.env.CATALOG_PUBLIC_URL ?? "";
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    price: row.price,
    currency: row.currency ?? "COP",
    category: row.category ?? null,
    image_url: row.image_url ?? row.images?.[0] ?? null,
    images: row.images ?? [],
    video_url: row.video_url ?? null,
    stock: row.stock ?? null,
    url: baseUrl ? `${baseUrl}/catalogo/${slug}/p/${row.id}` : null,
    attributes: row.attributes ?? {},
  };
}

export const Route = createFileRoute("/api/public/catalog/$slug/search")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ params, request }) => {
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") ?? "").trim();
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 6, 1), 20);

        const { data: bodega } = await supabaseAdmin
          .from("bodegas").select("id").eq("slug", params.slug).maybeSingle();

        if (!bodega) return Response.json({ products: [] }, { headers: CORS });

        let query = supabaseAdmin
          .from("products")
          .select("*")
          .eq("bodega_id", bodega.id)
          .limit(limit);

        if (q) {
          // Búsqueda básica en varios campos (ajusta según tu esquema)
          query = query.or(
            `name.ilike.%${q}%,description.ilike.%${q}%,category.ilike.%${q}%,sku.ilike.%${q}%`,
          );
        } else {
          query = query.order("created_at", { ascending: false });
        }

        const { data: rows } = await query;

        return Response.json(
          { products: (rows ?? []).map((r) => mapProduct(r, params.slug)) },
          { headers: CORS },
        );
      },
    },
  },
});
```

### `src/routes/api/public/catalog/$slug/product.$id.ts`
```typescript
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CORS = {
  /* mismo bloque */
};

export const Route = createFileRoute("/api/public/catalog/$slug/product/$id")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ params }) => {
        const { data: bodega } = await supabaseAdmin
          .from("bodegas").select("id").eq("slug", params.slug).maybeSingle();

        if (!bodega) return Response.json({ product: null }, { status: 404, headers: CORS });

        const { data: row } = await supabaseAdmin
          .from("products")
          .select("*")
          .eq("bodega_id", bodega.id)
          .eq("id", params.id)
          .maybeSingle();

        if (!row) return Response.json({ product: null }, { status: 404, headers: CORS });

        // reutiliza mapProduct
        return Response.json({ product: mapProduct(row, params.slug) }, { headers: CORS });
      },
    },
  },
});
```

> Ajusta los nombres de tabla/columna (`bodegas`, `products`, `slug`, `images`,
> `price`, etc.) al esquema real del proyecto. Lo importante es **devolver el
> JSON con el shape descrito en la sección 2**.

---

## 4. Validación de token (opcional pero recomendado)

Si quieres restringir el acceso, agrega al inicio de cada handler:
```typescript
const token = request.headers.get("X-Catalog-Token");

const { data: tk } = await supabaseAdmin
  .from("catalog_api_tokens")
  .select("token")
  .eq("slug", params.slug)
  .maybeSingle();

if (tk?.token && tk.token !== token) {
  return new Response("Unauthorized", { status: 401, headers: CORS });
}
```

Y crea la tabla:
```sql
create table public.catalog_api_tokens (
  slug text primary key,
  token text not null,
  created_at timestamptz default now()
);
grant select on public.catalog_api_tokens to service_role;
```
El mismo token se pega en el CRM Maple en *Configuración IA → Integración Catálogo → Token API*.

---

## 5. Cómo se conecta el CRM Maple

En el CRM Maple (este proyecto) el usuario abre:
> **Configuración IA → Integración Catálogo**

y configura:
- **URL base**: `https://sincro3.netlify.app`
- **Slug del catálogo**: `bodega-central-demo`
- **Token API**: el que generaste en `catalog_api_tokens` (opcional)
- **Permitir enviar imágenes**: ✅
- **Activar integración**: ✅

Luego pulsa **Probar conexión**. El CRM llama a `/health` y luego a `/search?q=&limit=3`. Si responde 200, se marca como **Conectado** (punto verde).

A partir de ese momento, cada vez que la IA del CRM responda a un cliente, tendrá disponibles dos herramientas:

| Tool | Acción |
|----------------------------|------------------------------------------------------------------------|
| `search_catalog` | Llama `/search?q=...` y devuelve los productos al modelo |
| `send_product_to_customer` | Llama `/product/{id}` y envía imagen + caption por WhatsApp al cliente |

La IA decide automáticamente cuándo usarlas según lo que escriba el cliente (“¿tienen cables HDMI?”, “precio del saltarín”, “quiero ver el adaptador”, etc.).

---

## 6. Checklist final para la otra IA

- [ ] Crear los 3 endpoints `/api/public/catalog/{slug}/{health|search|product/{id}}`.
- [ ] Devolver JSON con el shape de la sección 2 (mínimo `id`, `name`).
- [ ] Habilitar CORS (`Access-Control-Allow-Origin: *`).
- [ ] Probar manualmente:
  ```
  curl https://TU-DOMINIO/api/public/catalog/SLUG/health
  curl "https://TU-DOMINIO/api/public/catalog/SLUG/search?q=cable&limit=3"
  curl https://TU-DOMINIO/api/public/catalog/SLUG/product/ID
  ```
- [ ] (Opcional) Crear `catalog_api_tokens` y validar `X-Catalog-Token`.
- [ ] Compartir URL base, slug y token con el usuario del CRM Maple.

Listo: la IA del CRM ya puede vender productos reales del catálogo, con imágenes, precios y descripciones, y mantiene el historial completo de la conversación para responder con coherencia.
