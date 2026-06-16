# FASE 2A — Diseño de Memoria Persistente del Cliente

**Objetivo:** Que la IA recuerde entre conversaciones: productos vistos, intereses, preferencias, objeciones e intención de compra.

**Estado actual:** Solo `focused_product_snapshot` (JSONB en threads) y `purchase_intent` (texto). Todo lo demás se pierde entre conversaciones.

---

## 1. Diseño de Tabla

### Tabla: `customer_memory`

```sql
create table public.customer_memory (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  
  -- Resumen ejecutivo (generado por IA al finalizar cada conversación)
  executive_summary  text,                    -- max 500 chars, one-line summary of the customer
  
  -- Productos vistos (histórico completo)
  products_viewed    jsonb not null default '[]'::jsonb,
  -- Formato: [{ product_id, name, sku, price, category, viewed_at, source (search/carousel/detail) }]
  
  -- Intereses detectados
  interests          jsonb not null default '[]'::jsonb,
  -- Formato: [{ category, keywords[], confidence (0-1), first_detected_at, last_updated_at }]
  
  -- Preferencias explícitas
  preferences        jsonb not null default '{}'::jsonb,
  -- Formato: { color: "rojo", material: "madera", size: "grande", ... } extraído de conversaciones
  
  -- Objeciones
  objections         jsonb not null default '[]'::jsonb,
  -- Formato: [{ type: "price"|"shipping"|"trust"|"timing"|"other", description, mentioned_at }]
  
  -- Intención de compra
  purchase_intent    jsonb not null default '{}'::jsonb,
  -- Formato: { 
  --   current: "exploring"|"interested"|"ready"|"ordered"|"abandoned"|"not_interested",
  --   history: [{ status, changed_at, reason }],
  --   last_product_id: uuid,
  --   estimated_value: number
  -- }
  
  -- Último producto en foco (para retomar rápido)
  last_focused_product_id uuid,
  last_focused_product_at timestamptz,
  
  -- Métricas de conversación
  total_conversations    int not null default 0,
  total_messages_sent    int not null default 0,
  total_messages_received int not null default 0,
  last_conversation_at   timestamptz,
  last_conversation_id   uuid,                -- último thread_id
  
  -- Control de versiones y caducidad
  embedding             vector(384),          -- para búsqueda semántica (opcional, pgvector)
  version               int not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  
  unique (org_id, contact_id)
);
```

### Índices

```sql
-- Búsqueda por org + contacto (único)
create unique index idx_customer_memory_org_contact 
  on customer_memory (org_id, contact_id);

-- Contactos con intención de compra activa
create index idx_customer_memory_purchase_intent
  on customer_memory ((purchase_intent->>'current'))
  where (purchase_intent->>'current') in ('interested', 'ready');

-- Productos más vistos
create index idx_customer_memory_products_viewed
  on customer_memory using gin (products_viewed jsonb_path_ops);

-- Última conversación (para limpieza)
create index idx_customer_memory_last_conv
  on customer_memory (last_conversation_at);
```

---

## 2. Qué Datos Guardar

### 2.1 Products Viewed

Cada vez que la IA envía un producto (imagen/video/texto) o el cliente menciona uno.

```json
{
  "product_id": "uuid",
  "name": "Zapatero 6 niveles",
  "sku": "ZAP-001", 
  "price": 32200,
  "category": "hogar",
  "viewed_at": "2026-06-15T10:30:00Z",
  "source": "search",        // "search" | "carousel" | "detail" | "user_mention"
  "interaction": "sent"      // "sent" | "clicked" | "asked_detail" | "added_to_order"
}
```

**Límite:** Últimos 50 productos. Los más antiguos se descartan cuando se excede.

### 2.2 Interests

Categorías o palabras clave que el cliente ha preguntado repetidamente.

```json
{
  "category": "estantería",
  "keywords": ["6 niveles", "metálico", "resistente"],
  "confidence": 0.85,
  "first_detected_at": "2026-06-10T14:00:00Z",
  "last_updated_at": "2026-06-15T10:30:00Z",
  "mention_count": 4
}
```

**Límite:** Máximo 10 intereses. Al llegar a 10, se reemplaza el de menor confidence.

### 2.3 Preferences

Pares clave/valor extraídos explícitamente.

```json
{
  "color": "negro",
  "material": "metal",
  "tamaño": "grande",
  "precio_maximo": 50000,
  "envio": "domicilio",
  "horario_preferido": "tarde"
}
```

**Límite:** Máximo 20 pares. Se actualizan o agregan.

### 2.4 Objections

Objeciones explícitas del cliente.

```json
{
  "type": "price",
  "description": "dice que el envío es muy caro",
  "mentioned_at": "2026-06-15T10:35:00Z",
  "resolved": false,
  "resolved_at": null
}
```

Tipos: `price`, `shipping`, `trust`, `timing`, `quality`, `stock`, `other`

**Límite:** Máximo 10 objeciones. Las resueltas se archivan después de 30 días.

### 2.5 Purchase Intent

Máquina de estados de la intención de compra.

```
exploring → interested → ready → ordered → (completed)
                              ↘ abandoned
                              ↘ not_interested
                      
exploring → (sigue explorando)
abandoned → interested (si retoma después de días)
```

```json
{
  "current": "interested",
  "history": [
    { "status": "exploring", "changed_at": "2026-06-10T14:00:00Z", "reason": "nuevo contacto" },
    { "status": "interested", "changed_at": "2026-06-10T14:05:00Z", "reason": "pidió ver producto" },
    { "status": "abandoned", "changed_at": "2026-06-11T10:00:00Z", "reason": "no respondió en 24h" },
    { "status": "interested", "changed_at": "2026-06-15T10:30:00Z", "reason": "cliente retomó" }
  ],
  "last_product_id": "uuid",
  "estimated_value": 32200
}
```

---

## 3. Cuándo Guardar

### Trigger 1: Fin de conversación (cuando cliente deja de responder > 30 min)

```ts
// En ingest.ts, cuando pasan > 30 min desde último mensaje
onConversationEnd(contactId, threadId, orgId) {
  const summary = await generateExecutiveSummary(threadId);
  await updateCustomerMemory(contactId, orgId, {
    executive_summary: summary,
    total_conversations: +1,
    last_conversation_at: now,
    last_conversation_id: threadId,
  });
}
```

### Trigger 2: Producto enviado al cliente

```ts
// En executeToolCall, después de send_product_image/video o send_message con producto
onProductSent(contactId, orgId, product) {
  await appendProductToMemory(contactId, orgId, {
    product_id: product.id,
    name: product.name,
    price: product.price,
    category: product.category,
    viewed_at: now,
    source: "sent",
  });
  // Actualizar último producto en foco
  await updateLastFocusedProduct(contactId, orgId, product.id);
  // Si purchase_intent es "exploring", subir a "interested"
  await escalatePurchaseIntent(contactId, orgId, "interested", "recibió información de producto");
}
```

### Trigger 3: Cliente expresa interés, objeción o preferencia

```ts
// En runAiAgent, después de tool call o análisis del mensaje
onCustomerSignal(contactId, orgId, signalType, data) {
  switch(signalType) {
    case "interest":
      await upsertInterest(contactId, orgId, data.category, data.keywords);
      break;
    case "objection":
      await appendObjection(contactId, orgId, data.type, data.description);
      break;
    case "preference":
      await upsertPreference(contactId, orgId, data.key, data.value);
      break;
    case "purchase_intent":
      await updatePurchaseIntent(contactId, orgId, data.status, data.reason);
      break;
  }
}
```

### Trigger 4: Orden confirmada

```ts
// En confirm_order tool
onOrderConfirmed(contactId, orgId, orderData) {
  await updatePurchaseIntent(contactId, orgId, "ordered", "compra confirmada");
  await appendProductViewed(contactId, orgId, orderData.product, "added_to_order");
}
```

### Trigger 5: No respuesta del cliente (abandono)

```ts
// En no-response-worker.ts, cuando se detecta abandono
onCustomerAbandoned(contactId, orgId) {
  await updatePurchaseIntent(contactId, orgId, "abandoned", "no respondió en X tiempo");
  // NO borrar memory — es valiosa para cuando retome
}
```

---

## 4. Cuándo Actualizar

| Situación | Acción |
|---|---|
| Producto enviado | Append a `products_viewed`, update `last_focused_product` |
| Cliente menciona producto nuevo | Append a `products_viewed` con source=`user_mention` |
| Cliente expresa interés repetido | Incrementar `mention_count` en `interests` |
| Cliente dice "no me gusta X color" | Upsert en `preferences` (color != X) |
| Cliente dice "está caro" | Append a `objections` con type=price |
| Cliente vuelve después de días | Reactivar `purchase_intent` a `interested` |
| Conversación termina | Re-generar `executive_summary` |
| Orden confirmada | `purchase_intent` → ordered |

**NO actualizar:**
- Por mensajes de sistema o engine_commands
- Por mensajes del agente humano
- Por mensajes irrelevantes (saludos, despedidas)

---

## 5. Cómo Cargar la Memoria Antes de Construir el Prompt

### Ubicación en el flujo actual

En `ai.server.ts:runAiAgent()`, la memoria se cargaría entre las líneas 2134-2164 (después de cargar catálogo y thread), y se inyectaría como un bloque más en el `system` prompt (línea 2514).

### Función de carga

```ts
async function loadCustomerMemory(orgId: string, contactId: string): Promise<CustomerMemory | null> {
  if (!contactId) return null;
  
  const { data } = await supabaseAdmin
    .from("customer_memory")
    .select("*")
    .eq("org_id", orgId)
    .eq("contact_id", contactId)
    .maybeSingle();
  
  if (!data) return null;
  
  // Solo cargar datos relevantes (últimos 30 días para products_viewed)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentProducts = (data.products_viewed || [])
    .filter((p: any) => new Date(p.viewed_at) > thirtyDaysAgo)
    .slice(-20);  // últimos 20
  
  return {
    ...data,
    products_viewed: recentProducts,
  };
}
```

### Bloque de contexto en el prompt

Se insertaría como un bloque más en `system` (junto al knowledgeBase, orderFields, etc.):

```
=== MEMORIA DEL CLIENTE ===
Resumen: Cliente interesado en estanterías metálicas. Preguntó por opciones de 6 niveles. Objeción previa: precio de envío.
Último producto visto: Zapatero 6 niveles ($32.200) — hace 2 días
Intención de compra: interested (cambió de exploring hace 2 días)
Preferencias: color negro, material metal
Productos vistos recientemente: Zapatero 6 niveles, Estante 3 niveles, Organizador plástico
```

**Importante:** Este bloque debe ser CONCISO (< 500 chars). No se debe volcar el JSON completo. La IA debe procesar texto natural, no datos estructurados.

### Estrategia de compresión

1. `executive_summary`: se muestra siempre (es texto de 1 línea)
2. `purchase_intent.current`: se muestra siempre
3. `preferences`: se muestran como texto plano solo si hay datos
4. `interests`: top 3 por confidence
5. `products_viewed`: solo últimos 5 con nombre y fecha
6. `objections`: solo las no resueltas

---

## 6. Cómo Evitar Crecimiento Infinito

### 6.1 Límites en la tabla

| Campo | Límite | Estrategia |
|---|---|---|
| `products_viewed` | 50 items | FIFO: cuando llega a 50, elimina el más viejo |
| `interests` | 10 items | Al llegar a 10, reemplaza el de menor confidence |
| `preferences` | 20 pares | Al llegar a 20, nuevos reemplazan los más viejos |
| `objections` | 10 items no resueltas | Resueltas se archivan (marcar `resolved_at`) y se limpian a los 30 días |

### 6.2 Cleanup programado

```sql
-- Cron job diario: limpiar memoria vieja
-- Productos vistos > 90 días
-- Objeciones resueltas > 30 días
-- Contactos sin conversación en > 180 días: marcar para archive
```

```ts
// cleanup-customer-memory.ts (worker diario)
async function cleanupCustomerMemory() {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  
  // Limpiar products_viewed viejos dentro del JSONB
  await supabaseAdmin.rpc('cleanup_customer_memory_products', { 
    older_than: ninetyDaysAgo.toISOString() 
  });
  
  // Soft-delete contactos inactivos > 180 días
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  await supabaseAdmin
    .from('customer_memory')
    .update({ archive: true })
    .lt('last_conversation_at', sixMonthsAgo.toISOString());
}
```

### 6.3 Tamaño máximo por registro

Un registro de `customer_memory` no debe exceder **10 KB** (el JSONB típico es < 3 KB). Si se acerca al límite, se comprimen los arrays más viejos.

---

## 7. Integración con contacts, threads y messages

### Relación con contacts

```
contacts (1) ────────── (1) customer_memory
```

`customer_memory.contact_id` = `contacts.id` (FK con CASCADE). Cuando se elimina un contacto, se elimina su memoria.

```sql
alter table customer_memory
  add constraint fk_customer_memory_contact
  foreign key (contact_id) references contacts(id) on delete cascade;
```

### Relación con threads

```
threads (N) ────────── (1) customer_memory
```

Cada thread pertenece a un contacto. La memoria se accede a través de `contact_id`. El `last_conversation_id` guarda el último thread para referencia.

### Relación con messages

```
messages (N) ────────── (1) customer_memory (derived)
```

La memoria NO se relaciona directamente con messages. Es un derivado/resumen. Los mensajes se usan para generar/actualizar la memoria, pero no se referencian.

### Flujo completo

```
[Mensaje entrante] 
  → ingest.ts
    → runAiAgent()
      → loadCustomerMemory(contactId)  // carga memoria antes del prompt
      → construye prompt con bloque MEMORIA DEL CLIENTE
      → IA responde
      → onProductSent() / onCustomerSignal()  // actualiza memoria
  → fin de conversación (> 30 min)
    → onConversationEnd()  // genera executive_summary
```

### Migración desde sistema actual

No se requiere migración de datos. El sistema actual no tiene memoria que migrar. `focused_product_snapshot` puede convivir temporalmente y luego deprecarse en FASE 3.

---

## 8. Diagrama

```
┌────────────────────────────────────────────────────────────────────┐
│                    customer_memory (1 por contacto)                │
├────────────────────────────────────────────────────────────────────┤
│  org_id │ contact_id │ executive_summary │ version │ embedding    │
│────────────────────────────────────────────────────────────────────│
│  products_viewed  [ ]  ← lista de últimos 50 productos            │
│  interests        [ ]  ← top 10 intereses con confidence          │
│  preferences      { }  ← pares clave/valor                        │
│  objections       [ ]  ← objeciones no resueltas                  │
│  purchase_intent  { }  ← estado + historial                       │
│  Último foco, métricas, timestamps                                │
└────────────────────────────────────────────────────────────────────┘
          │
          │ 1
          ▼
┌──────────────────┐      ┌──────────────────┐
│    contacts      │      │    threads       │
├──────────────────┤      ├──────────────────┤
│ id, wa_id, ...   │      │ id, contact_id,  │
│                  │      │ messages...      │
└──────────────────┘      └──────────────────┘
          │                       │
          │ 1:N                   │ (derivado)
          ▼                       ▼
┌───────────────────────────────────────────────┐
│        Flujo en ejecución                     │
│                                               │
│  ingest.ts → runAiAgent()                     │
│    ├─ loadCustomerMemory()  ← carga memoria   │
│    ├─ buildPrompt()         ← inyecta bloque  │
│    ├─ callProvider()        ← IA responde     │
│    └─ saveCustomerMemory()  ← persiste        │
└───────────────────────────────────────────────┘
```

---

## 9. Flujo Completo

```
1. CLIENTE envía mensaje
2. ingest.ts recibe
3. runAiAgent() es llamado
4. loadCustomerMemory(contactId)
   │
   ├─ ¿Existe registro? → Sí → cargar: executive_summary, 
   │     purchase_intent, interests top 3, preferences,
   │     objections no resueltas, últimos 5 productos
   │
   └─ ¿Existe registro? → No → crear registro vacío
   │
5. Se construye prompt con bloque MEMORIA DEL CLIENTE
   │
6. Se ejecuta IA (tool calling)
   │
7. Durante ejecución:
   ├─ ¿search_products? → registrar interés por categoría
   ├─ ¿send_product_image? → append products_viewed
   ├─ ¿confirm_order? → purchase_intent = ordered
   ├─ ¿transfer_to_human? → purchase_intent = abandoned
   └─ Análisis de mensaje del cliente:
       ├─ detectar objeciones (regex/IA)
       ├─ detectar preferencias (regex/IA)
       └─ detectar cambio de intención
   │
8. Después de respuesta:
   ├─ saveCustomerMemory() → upsert en DB
   └─ Si es fin de conversación:
       └─ generateExecutiveSummary() → update
```

---

## 10. Funciones Propuestas (API)

| Función | Propósito |
|---|---|
| `loadCustomerMemory(orgId, contactId)` | Carga y comprime memoria para el prompt |
| `saveCustomerMemory(orgId, contactId, delta)` | Upsert de cambios parciales |
| `appendProduct(orgId, contactId, product, source)` | Agrega producto visto |
| `upsertInterest(orgId, contactId, category, keywords)` | Registra/refuerza interés |
| `upsertPreference(orgId, contactId, key, value)` | Guarda preferencia |
| `appendObjection(orgId, contactId, type, description)` | Registra objeción |
| `updatePurchaseIntent(orgId, contactId, status, reason)` | Cambia estado de intención |
| `generateExecutiveSummary(threadId)` | IA genera resumen de 1 línea |
| `cleanupOldMemory()` | Worker diario de limpieza |

---

## 11. Riesgos

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | **Memoria incorrecta o inconsistente** | Alta | Medio | Validar con IA antes de guardar; permitir override manual desde UI |
| R2 | **Crecimiento de tabla** | Baja | Alto | Límites estrictos (10 KB/registro) + cleanup diario |
| R3 | **Latencia al cargar/guardar en cada mensaje** | Media | Medio | Carga lazy (solo si hay contacto_id), save con upsert parcial |
| R4 | **IA usa memoria de sesión anterior para responder incorrectamente** | Media | Alto | El bloque de memoria debe ser explícito como "HISTORIAL" no como "CONTEXTO ACTUAL". La IA debe saber que la situación pudo cambiar. |
| R5 | **Privacidad: datos sensibles en memoria** | Baja | Alto | No guardar datos personales sensibles en memoria (solo en contacts). Encriptar JSONB si es necesario. |
| R6 | **Memoria de contacto equivocado (mismo número, persona diferente)** | Baja | Medio | Vincular por contact_id (único por org), no por wa_id. |
| R7 | **Doble escritura concurrente (race condition)** | Media | Bajo | Usar upsert con `ON CONFLICT` y updated_at; cargar y guardar en la misma transacción si es crítico |

---

## 12. Estrategia Recomendada

### Fase 2A.1 (Implementación base)
1. Crear tabla `customer_memory` + índices (SQL de migración)
2. Implementar `loadCustomerMemory()` y `saveCustomerMemory()` como módulo separado `customer-memory.server.ts`
3. Integrar carga en `runAiAgent()` antes del prompt
4. Guardar al final de `runAiAgent()` si hubo cambios detectados
5. Implementar `onProductSent()` y `onOrderConfirmed()` triggers

### Fase 2A.2 (Análisis de señales)
6. Implementar detección de intereses (categorías de productos buscados)
7. Implementar detección de objeciones (regex + keywords: "caro", "no me gusta", "no tengo tiempo")
8. Implementar detección de preferencias (colores, materiales, tamaños)
9. Integrar con intent-classifier.ts actual

### Fase 2A.3 (Madurez)
10. Implementar `executive_summary` con IA al final de conversación
11. Agregar cleanup worker
12. Agregar UI en panel de contactos para ver/editar memoria manualmente
13. Reemplazar `focused_product_snapshot` con la nueva memoria
14. Agregar pgvector embedding para búsqueda semántica de clientes similares

### Priorización

**Alta (FASE 2A.1):** Tabla + carga en prompt + guardado básico (products_viewed, purchase_intent)
**Media (FASE 2A.2):** Intereses, preferencias, objeciones
**Baja (FASE 2A.3):** Executive summary, embedding, UI, cleanup

---

*Fin del diseño FASE 2A. Sin implementar — solo documento de diseño.*
