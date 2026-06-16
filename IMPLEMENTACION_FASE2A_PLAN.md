# FASE 2A — Plan de Implementación: Memoria del Cliente

**Estado:** Planificación — sin código escrito  
**Objetivo:** Implementar memoria persistente del cliente en el CRM conversacional

---

## 1. Arquitectura Final

```
┌──────────────────────────────────────────────────────────────────┐
│                      customer_memory table                       │
│  (1 registro por contacto, upsert, JSONB + texto, < 10 KB c/u)   │
├──────────────────────────────────────────────────────────────────┤
│  org_id | contact_id | executive_summary | version | updated_at  │
│──────────────────────────────────────────────────────────────────│
│  products_viewed  [ {product_id, name, price, category,          │
│                     viewed_at, source, interaction} ]  ← últ 50  │
│  interests        [ {category, keywords[], confidence,            │
│                     mention_count, last_updated_at} ]  ← top 10  │
│  preferences      { color, material, size, price_range, ... }     │
│  objections       [ {type, description, resolved,                │
│                     mentioned_at, resolved_at} ]  ← últ 10       │
│  purchase_intent  { current, history[], last_product_id,         │
│                     estimated_value }                             │
│  last_focused_product_id | last_focused_product_at               │
│  total_conversations | total_messages (sent/recv)                │
│  last_conversation_at | last_conversation_id                     │
└──────────────────────────────────────────────────────────────────┘
           │
           │ 1 (FK → contacts.id ON DELETE CASCADE)
           ▼
┌──────────────────────┐
│      contacts        │
│  id, wa_id, phone,   │
│  display_name, ...   │
└──────────────────────┘
```

### Archivos involucrados

| Archivo | Acción | Razón |
|---|---|---|
| **NUEVO:** `src/lib/customer-memory.server.ts` | Crear | Módulo central: load, save, extract, compress |
| `src/lib/ai.server.ts` | Modificar (~20 líneas) | Cargar memoria en `runAiAgent()` e inyectar bloque en el prompt |
| `src/routes/api/public/engine/ingest.ts` | Modificar (~15 líneas) | Guardar memoria después de que la IA responde |
| **NUEVO:** `supabase/migrations/...customer_memory.sql` | Crear | Migración de la tabla + índices + RLS |

### Lo que NO se modifica

| Archivo | Por qué |
|---|---|
| `src/lib/catalog.server.ts` | El catálogo no cambia |
| `src/lib/catalog-search.ts` | La búsqueda no cambia |
| `src/lib/intent-classifier.ts` | Se puede migrar después, no ahora |
| `src/lib/flow-trigger.server.ts` | Los flujos no cambian |
| `src/lib/flow-runner.server.ts` | Los flujos no cambian |
| `src/lib/flow-blocks.ts` | Los pasos de flujo no cambian |
| `src/lib/flows.functions.ts` | El CRUD de flujos no cambia |
| `src/lib/sessions.functions.ts` | Las sesiones no cambian |
| `src/lib/orders.functions.ts` | Los pedidos no cambian |
| `src/lib/retry-manager.server.ts` | Los reintentos no cambian |
| `src/routes/api/public/engine/commands.ts` | El polling no cambia |
| `src/routes/api/public/engine/retry-processor.ts` | El retry processor no cambia |
| `src/routes/api/public/cron/dispatch.ts` | Los cron jobs no cambian |
| `src/routes/api/public/cron/flow-scheduler.ts` | Los cron jobs no cambian |
| `src/routes/api/internal/no-response-worker.ts` | Workers no cambian |
| `src/routes/api/public/mapleads/ingest.ts` | Mapleads no cambia |

---

## 2. Tabla Nueva

### SQL de migración

```sql
-- ============================================================
-- Migración: customer_memory
-- Versión: 1.0
-- ============================================================

create table if not exists public.customer_memory (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  
  -- Resumen (generado por IA al finalizar conversación larga)
  executive_summary  text,
  
  -- Productos vistos (últimos 50, FIFO)
  products_viewed    jsonb not null default '[]'::jsonb,
  
  -- Intereses detectados (top 10, ordenados por confidence)
  interests          jsonb not null default '[]'::jsonb,
  
  -- Preferencias (pares clave/valor)
  preferences        jsonb not null default '{}'::jsonb,
  
  -- Objeciones no resueltas (máximo 10)
  objections         jsonb not null default '[]'::jsonb,
  
  -- Intención de compra con historial
  purchase_intent    jsonb not null default '{}'::jsonb,
  
  -- Último producto en foco
  last_focused_product_id uuid,
  last_focused_product_at timestamptz,
  
  -- Métricas de conversación
  total_conversations     int not null default 0,
  total_messages_sent     int not null default 0,
  total_messages_received int not null default 0,
  last_conversation_at    timestamptz,
  last_conversation_id    uuid references public.threads(id) on delete set null,
  
  -- Control
  version  int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- Garantiza 1 registro por contacto por organización
  unique (org_id, contact_id)
);

-- Índices
create unique index if not exists idx_customer_memory_org_contact
  on public.customer_memory (org_id, contact_id);

create index if not exists idx_customer_memory_last_conv
  on public.customer_memory (last_conversation_at)
  where last_conversation_at is not null;

create index if not exists idx_customer_memory_purchase_intent
  on public.customer_memory ((purchase_intent ->> 'current'::text))
  where (purchase_intent ->> 'current'::text) in ('interested', 'ready', 'ordered');

-- RLS: los miembros de la org pueden leer/escribir su propia memoria
alter table public.customer_memory enable row level security;

create policy "customer_memory_select" on public.customer_memory
  for select to authenticated
  using (org_id = (select org_id from public.user_roles where user_id = auth.uid() limit 1));

create policy "customer_memory_insert" on public.customer_memory
  for insert to authenticated
  with check (org_id = (select org_id from public.user_roles where user_id = auth.uid() limit 1));

create policy "customer_memory_update" on public.customer_memory
  for update to authenticated
  using (org_id = (select org_id from public.user_roles where user_id = auth.uid() limit 1))
  with check (org_id = (select org_id from public.user_roles where user_id = auth.uid() limit 1));

create policy "customer_memory_delete" on public.customer_memory
  for delete to authenticated
  using (org_id = (select org_id from public.user_roles where user_id = auth.uid() limit 1));

grant select, insert, update, delete on public.customer_memory to authenticated;
grant all on public.customer_memory to service_role;
```

### Filas estimadas por registro

| Campo | Tamaño típico |
|---|---|
| executive_summary | ~100-300 chars |
| products_viewed (50 items) | ~3000-5000 chars |
| interests (10 items) | ~800-1200 chars |
| preferences (20 pares) | ~400-800 chars |
| objections (10 items) | ~1000-2000 chars |
| purchase_intent | ~300-500 chars |
| **Total estimado** | **~3-10 KB** |

---

## 3. Nuevo Módulo: `customer-memory.server.ts`

### API del módulo

```
┌─────────────────────────────────────────────────────────┐
│               customer-memory.server.ts                  │
├─────────────────────────────────────────────────────────┤
│  loadMemory(orgId, contactId) → MemoryBlock | null      │
│     Carga + comprime la memoria para el prompt           │
│                                                          │
│  compressForPrompt(memory) → string (< 500 chars)        │
│     Convierte la memoria en texto natural para la IA     │
│                                                          │
│  extractSignals(messageText, recentHistory) → Signal[]   │
│     Capa 1: regex puro, detecta señales candidatas       │
│                                                          │
│  validateSignals(signals, messageText, currentMemory)     │
│     → Signal[]                                           │
│     Capa 2: IA valida señales y resuelve conflictos      │
│                                                          │
│  saveMemory(orgId, contactId, signals, metadata) → void  │
│     Aplica reglas de merge y persiste en DB              │
│                                                          │
│  appendProduct(orgId, contactId, product, source) → void │
│     Agrega producto a products_viewed (FIFO 50)          │
│                                                          │
│  updatePurchaseIntent(orgId, contactId, status, reason)  │
│     → void                                               │
│     Cambia estado de intención + registra historial      │
│                                                          │
│  resolveObjection(orgId, contactId, type) → void         │
│     Marca objeción como resuelta                         │
│                                                          │
│  generateSummary(threadId) → string                      │
│     IA genera resumen de 1 línea de la conversación      │
│                                                          │
│  cleanupOldMemory() → void                               │
│     Worker diario: purga datos viejos, archiva           │
└─────────────────────────────────────────────────────────┘
```

### Integración en `runAiAgent()` (ai.server.ts)

Dentro de `runAiAgent()`, después de cargar el thread y antes de construir el prompt:

```
// ACTUAL (línea ~2148):
const result = await supabaseAdmin.from("threads")
  .select("purchase_intent, ai_prompt_extension")
  .eq("id", threadId).maybeSingle();
threadRow = result.data;

// NUEVO: Cargar memoria del cliente
let memoryBlock = "";
if (contactId) {
  const memory = await loadMemory(orgId, contactId);
  if (memory) {
    memoryBlock = compressForPrompt(memory);
  }
}
```

Luego agregar `memoryBlock` al array `system` (línea ~2514):

```
const system = [
  ...,
  memoryBlock ? `\n\n=== MEMORIA DEL CLIENTE ===\n${memoryBlock}` : "",
  ...
].join("");
```

### Integración en `ingest.ts` (después de runAiAgent)

Después de que `runAiAgent()` devuelve `{ reply, actions }` (después de línea ~666), guardar memoria:

```
// NUEVO: Guardar memoria basada en el mensaje del cliente y actions de la IA
if (contactId && text) {  // 'text' es el mensaje original del cliente
  const signals = await extractSignals(text, historyWithContext);
  if (signals.length > 0) {
    await saveMemory(orgId, contactId, signals, {
      threadId,
      actions,
      lastProductSent: actions.includes('send_product_image') || 
                       actions.includes('send_product_video'),
    });
  }
}
```

---

## 4. Flujo Completo

```
1. CLIENTE → Mensaje WhatsApp
   │
2. INGEST.TS recibe el mensaje
   │
3. Busca/crea contacto y thread
   │
4. Llama a runAiAgent(orgId, threadId, contactId, sessionId, chatId, messages, cfg)
   │
   ├─ 4a. Carga catálogo, thread, order_fields, knowledge_sources (existente)
   │
   ├─ 4b. NUEVO: Carga customer_memory si contactId existe
   │   │    └─ loadMemory(orgId, contactId)
   │   │    └─ compressForPrompt(memory) → texto < 500 chars
   │   │
   │   ├─ 4c. Construye prompt (existente) + bloque MEMORIA DEL CLIENTE
   │   │
   │   ├─ 4d. Llama a la IA (existente)
   │   │
   │   └─ 4e. Devuelve { reply, actions }
   │
5. Ingest.tS envía reply al cliente (existente)
   │
6. NUEVO: Extrae y guarda memoria
   │
   ├─ 6a. extractSignals(lastUserMessage, recentHistory)
   │   │    └─ Capa 1: regex sobre el último mensaje del cliente
   │   │    └─ Capa 2: (opcional) validación por IA
   │   │
   │   └─ 6b. saveMemory(orgId, contactId, signals, { threadId, actions })
   │       │
   │       ├─ ¿Producto fue enviado? → appendProduct()
   │       ├─ ¿Intención cambió? → updatePurchaseIntent()
   │       ├─ ¿Nueva objeción? → append a objections[]
   │       ├─ ¿Nuevo interés? → upsert en interests[]
   │       └─ ¿Nueva preferencia? → upsert en preferences{}
   │
7. FIN
```

---

## 5. Detalle de Funciones

### 5.1 `loadMemory(orgId, contactId)`

```ts
async function loadMemory(orgId: string, contactId: string): Promise<CustomerMemory | null> {
  const { data } = await supabaseAdmin
    .from('customer_memory')
    .select('*')
    .eq('org_id', orgId)
    .eq('contact_id', contactId)
    .maybeSingle();
  return data;
}
```

### 5.2 `compressForPrompt(memory)`

Convierte la memoria estructurada en texto natural (< 500 chars):

```
"📋 Perfil: consumidor final
🎯 Interés: estanterías metálicas (fuerte), organizadores (leve)
🎨 Prefiere: color negro, material metal
⚠️ Objeción pendiente: costo de envío
💳 Intención: interested
📦 Último producto: Estante 3 niveles metálico — $45.000"

Reglas de compresión:
- executive_summary: siempre incluido
- interests: solo top 3 por confidence
- preferences: solo las que tienen valor
- objections: solo no resueltas, máximo 2
- purchase_intent: solo current + último cambio
- products_viewed: solo último producto con nombre y precio
```

### 5.3 `extractSignals(messageText, recentHistory)`

Capa 1: aplica ~40 reglas regex. Retorna `Signal[]`:

```ts
type Signal = {
  type: 'interest' | 'preference' | 'objection' | 'intent' | 'profile';
  subtype: string;          // 'product_category' | 'color' | 'price' | ...
  value: string;            // valor extraído
  confidence: number;       // 0.0 - 1.0
  source: 'pattern' | 'ai';
};
```

Reglas incluidas:
- **Intereses:** I1-I4 (busco, quiero, necesito, me gusta, es para...)
- **Preferencias:** P1-P5 (colores, materiales, tamaño, precio)
- **Objeciones:** O1-O10 (caro, envío caro, desconfianza, timing, decisión, comparación, calidad, stock)
- **Intención:** C1-C6 (cómo comprar, lo quiero, voy a comprar, no gracias, silencio)
- **Perfil:** B1-B3 (soy distribuidor, urgente, lo decide mi...)

### 5.4 `saveMemory(orgId, contactId, signals, metadata)`

```ts
async function saveMemory(
  orgId: string,
  contactId: string,
  signals: Signal[],
  metadata: { threadId: string; actions: string[]; lastProductSent: boolean }
): Promise<void> {
  // 1. Cargar memoria actual
  const current = await loadMemory(orgId, contactId) ?? createEmptyMemory();
  
  // 2. Si se envió un producto, detectar cuál y guardar
  if (metadata.lastProductSent) {
    // El producto se obtiene de focused_product_snapshot o del contexto
    current.products_viewed = appendProductToArray(current.products_viewed, product);
  }
  
  // 3. Procesar cada señal
  for (const signal of signals) {
    switch (signal.type) {
      case 'interest':
        current.interests = upsertInterest(current.interests, signal);
        break;
      case 'preference':
        current.preferences = upsertPreference(current.preferences, signal);
        break;
      case 'objection':
        current.objections = appendObjection(current.objections, signal);
        break;
      case 'intent':
        current.purchase_intent = updateIntent(current.purchase_intent, signal);
        break;
      case 'profile':
        current = mergeProfile(current, signal);
        break;
    }
  }
  
  // 4. Actualizar métricas
  current.total_messages_received += 1;
  current.last_conversation_at = new Date();
  current.last_conversation_id = metadata.threadId;
  current.updated_at = new Date();
  
  // 5. Persistir
  await supabaseAdmin
    .from('customer_memory')
    .upsert(current, { onConflict: 'org_id,contact_id' });
}
```

---

## 6. Reglas de Extracción (Capa 1 — Resumen)

### Intereses

| Patrón | Memoria | Confianza |
|---|---|---|
| `(busco\|quiero\|necesito\|estoy buscando\|me interesa\|tienen\|hay) ...` | interest.product_category | 0.8 |
| `(me gusta\|me interesó\|me llamó la atención) ...` | interest.product_category | 0.7 |
| `(es para\|lo quiero para\|necesito para) ...` | interest.use_case | 0.7 |
| Misma categoría mencionada >2 veces en 5 mensajes | interest.product_category | 0.9 |

### Preferencias

| Patrón | Memoria | Confianza |
|---|---|---|
| Adjetivo de color cerca de nombre de producto | preference.color | 0.7 |
| `(de\|en) (madera\|metal\|plástico\|vidrio) ...` | preference.material | 0.7 |
| `(que sea\|prefiero\|quisiera\|me gusta más) ...` | preference.* | 0.6 |
| `(económico\|barato) / (caro\|de calidad)` | preference.price_range | 0.7 |
| `(grande\|pequeño\|mediano)` referido a tamaño | preference.size | 0.6 |

### Objeciones

| Patrón | Memoria | Confianza |
|---|---|---|
| `(está\|es\|muy) caro\|costoso\|elevado` | objection.price | 0.9 |
| `no me alcanza\|no tengo plata\|no me da el presupuesto` | objection.price | 0.9 |
| `el envío es muy caro` | objection.shipping | 0.9 |
| `cuánto tarda\|demora el envío` | objection.shipping | 0.6 |
| `(cómo sé\|me da desconfianza\|no me convence) ...` | objection.trust | 0.7 |
| `(ahora no\|estoy ocupado\|esta semana no)` | objection.timing | 0.8 |
| `(tengo que consultar\|preguntar\|hablar con) ...` | objection.decision | 0.8 |
| `(déjame ver\|voy a comparar\|voy a pensar)` | objection.comparison | 0.7 |
| `(no me gusta\|no es lo que busco\|esperaba algo) ...` | objection.quality | 0.7 |
| `(tienen stock\|hay disponible\|se acabó\|agotado)` | objection.stock | 0.7 |

### Intención de Compra

| Patrón | Estado | Confianza |
|---|---|---|
| `(cómo comprar\|quiero pedir\|lo quiero\|lo compro\|lo llevo\|dámelo)` | ready | 0.9 |
| `(voy a\|pienso\|quisiera) comprar\|pedir` | interested→ready | 0.7 |
| `(próxima semana\|próximo mes)` + compra | interested (diferido) | 0.6 |
| `(no gracias\|no quiero\|solo mirando\|ya tengo)` | not_interested | 0.9 |
| Silencio > 48h después de ready/interested | abandoned | 0.7 (por tiempo) |

### Perfil Comercial

| Patrón | Memoria | Confianza |
|---|---|---|
| `(soy\|somos\|trabajo para) distribuidor\|tienda\|negocio\|mayorista` | profile.customer_type = "comercial" | 0.8 |
| `(lo necesito ya\|urgente\|para ayer)` | profile.urgency = "alta" | 0.7 |
| `(lo decide\|lo consulto con\|le pregunto a) ...` | profile.decision_role | 0.8 |

---

## 7. Estrategia Anti-Falsos-Positivos

### Filtros de Exclusión

NO extraer señales cuando:
- El mensaje es "sí", "no", "ok", "👍", "😊", "gracias"
- El cliente está en modo `collecting_data` (dando datos de pedido)
- El mensaje es respuesta a pregunta cerrada del agente
- El mensaje contiene solo números o selecciones ("la 3")
- El mensaje es saludo o despedida ("hola", "chao")
- El patrón aparece en contexto negativo ("NO busco eso")

### Cuarentena de Señales Débiles

Señales con confianza < 0.6 van a un buffer en memoria volátil:
- Si la misma señal aparece 3+ veces en la misma conversación → se promueve a persistente
- Si la conversación termina sin promoción → se descarta

### Umbrales

| Tipo | Confianza mínima para guardar |
|---|---|
| interest | 0.5 |
| preference | 0.5 |
| objection | 0.7 |
| intent | 0.6 |
| profile | 0.6 |

---

## 8. Plan de Implementación Paso a Paso

### Paso 1: Migración de Base de Datos

**Archivos:** `supabase/migrations/...customer_memory.sql` (nuevo)  
**Duración:** 30 minutos  
**Riesgo:** Ninguno (tabla nueva, no afecta existentes)  
**Verificación:** `SELECT * FROM customer_memory LIMIT 1;` debe funcionar

### Paso 2: Módulo `customer-memory.server.ts`

**Archivos:** `src/lib/customer-memory.server.ts` (nuevo)  
**Duración:** 2-3 horas  
**Funciones:** loadMemory, compressForPrompt, extractSignals, saveMemory  
**Riesgo:** Bajo (solo importado cuando se llame, no afecta flujo actual)

### Paso 3: Integrar en `ai.server.ts`

**Archivos:** `src/lib/ai.server.ts`  
**Cambios:** 
- Importar `loadMemory` y `compressForPrompt`
- Llamar después de cargar thread (línea ~2156)
- Agregar bloque al array `system` (línea ~2514)

**Duración:** 30 minutos  
**Riesgo:** Bajo (solo lectura de DB + agregar texto al prompt)

### Paso 4: Integrar en `ingest.ts`

**Archivos:** `src/routes/api/public/engine/ingest.ts`  
**Cambios:**
- Importar `extractSignals` y `saveMemory`
- Llamar después de `runAiAgent()` (después de línea ~666)
- Pasar mensaje original del cliente + lastUserText + actions

**Duración:** 30 minutos  
**Riesgo:** Bajo (solo se ejecuta después de que la IA respondió exitosamente)

### Paso 5: Completar reglas de extracción (Capa 1)

**Archivos:** `src/lib/customer-memory.server.ts`  
**Cambios:** Implementar las 40+ reglas regex para intereses, preferencias, objeciones, intención y perfil  
**Duración:** 2-3 horas  
**Riesgo:** Bajo (código nuevo, no modifica existente)

### Paso 6: Pruebas y refinamiento

**Duración:** 1-2 días  
**Actividades:**
- Probar con mensajes reales de clientes
- Ajustar umbrales de confianza
- Verificar que no haya falsos positivos
- Verificar que la memoria se cargue correctamente en el prompt
- Monitorear latencia (debe ser < 50ms para Capa 1)

---

## 9. Riesgos

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| 1 | **Latencia en runAiAgent por consulta a DB** | Baja | Media | loadMemory es 1 query indexada por PK, < 5ms |
| 2 | **Memoria incorrecta incluida en prompt** | Media | Media | El bloque es < 500 chars y dice explícitamente "memoria histórica". La IA puede ignorarlo si no aplica |
| 3 | **Falsos positivos en extractor** | Media | Baja | Umbrales conservadores + cuarentena. Peor caso: memoria con ruido irrelevante |
| 4 | **Escritura concurrente (2 mensajes a la vez)** | Baja | Baja | upsert con ON CONFLICT maneja el último write. Datos no críticos si se pierde 1 escritura |
| 5 | **Crecimiento de tabla** | Baja | Media | Límites estrictos (50 productos, 10 intereses, etc.) + cleanup worker futuro |
| 6 | **Regresión en el prompt actual** | Baja | Alta | El bloque de memoria se agrega al FINAL del system prompt. No modifica nada existente |

---

## 10. Cronograma

| Día | Actividad | Entregable |
|---|---|---|
| 1 | Migración DB + módulo customer-memory.server.ts | Tabla creada + funciones load/save/compress |
| 2 | Integración en ai.server.ts + ingest.ts | Memoria cargada en prompt + guardada post-respuesta |
| 3 | Reglas de extracción (Capa 1) | 40+ patrones implementados |
| 4 | Pruebas + ajuste de umbrales | Memoria funcional en staging |
| 5 | Monitoreo + refinamiento | Despliegue a producción |

**Tiempo total estimado:** 5 días hábiles  
**Líneas nuevas:** ~400-500 (customer-memory.server.ts)  
**Líneas modificadas:** ~35 (ai.server.ts + ingest.ts)  
**Dependencias:** Ninguna bloqueante

---

*Fin del plan de implementación FASE 2A. Listo para comenzar cuando se apruebe.*
