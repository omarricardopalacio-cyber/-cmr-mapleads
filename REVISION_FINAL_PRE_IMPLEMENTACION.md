# Revisión Final Pre-Implementación — Fase 2A

## 1. Componentes existentes que se reutilizan

| Componente | Ubicación | Se reutiliza para |
|---|---|---|
| `contacts.crm_data` (jsonb) | Tabla `contacts`, columna existente | Almacenar memoria del cliente SIN tabla nueva |
| `focused_product_snapshot` (jsonb) + `focused_product_id` + `focused_updated_at` | Tabla `threads`, 3 columnas existentes | Productos vistos + último producto en foco |
| `purchase_intent` (text) | Tabla `threads`, columna existente | Intención de compra (mejorar estados) |
| `saveFocusedProduct()` / `loadFocusedProduct()` | `ai.server.ts:995-1088` | Patrón de guardado/carga de memoria ya implementado y probado |
| `saveCatalogSearchState()` / `loadCatalogSearchState()` | `ai.server.ts:1220-1335` | Historial de búsquedas ya implementado |
| `_search_history` (últimas 20 queries) | Dentro de `focused_product_snapshot` | Historial de búsquedas, reutilizar estructura existente |

## 2. Cómo funciona `focused_product_snapshot` hoy

- **JSONB en `threads`**, no en `contacts` (vive en el hilo, no en el contacto)
- **`saveFocusedProduct()`** guarda: `{ id, name, price, sku, image_url, video_url }` del producto actual
- **`loadFocusedProduct()`** lo recupera con **expiración de 6 horas** (después vuelve `null`)
- **`saveCatalogSearchState()`** guarda dentro del mismo JSONB: `_catalog_search { query, shown_ids, products[] }` y `_search_history[]` (últimas 20 consultas)
- **Sincroniza a `contacts.crm_data`**: cada vez que se guarda foco, también escribe en `contacts.crm_data.focused_product_*` — esto SÍ persiste entre sesiones (aunque con la misma expiración de 6h al cargar)
- **Problema clave:** Solo guarda el último producto, no el historial completo. Solo vive 6h al cargarse. Está atado al thread, no al contacto.

## 3. ¿Existe ya memoria operativa equivalente?

| Memoria | ¿Existe? | Limitación |
|---|---|---|
| Último producto visto | ✅ `contacts.crm_data.focused_product_*` | Solo 1 producto, expira 6h al cargar |
| Últimas búsquedas | ✅ `threads.focused_product_snapshot._search_history` | Atado al thread, se pierde si cambia de hilo |
| Intención de compra | ✅ `threads.purchase_intent` | Solo texto plano, sin historial de cambios |
| Productos enviados (últimos 30 min) | ✅ `engine_commands` + `loadRecentlyShownProducts()` | Solo 30 min, solo los enviados con media |
| **Historial completo de productos vistos** | ❌ No existe | — |
| **Intereses (categorías)** | ❌ No existe | — |
| **Preferencias (color, material, tamaño)** | ❌ No existe | — |
| **Objeciones** | ❌ No existe | — |
| **Historial de intención de compra** | ❌ No existe (solo el estado actual) | — |
| **Memoria cross-sesión (día siguiente)** | ❌ `crm_data` es lo único, y expira al cargar a las 6h | — |

## 4. Cambios para minimizar complejidad

| Cambio | Complejidad actual (plan original) | Complejidad propuesta | Ahorro |
|---|---|---|---|
| **NO crear tabla nueva.** Usar `contacts.crm_data` (jsonb) que YA existe con RLS, índices y políticas | Crear tabla + migración + RLS + índices + permisos | Solo extender JSONB existente | ~2 horas |
| **NO crear módulo separado.** Agregar funciones al inicio de `ai.server.ts` donde ya vive `saveFocusedProduct` | Nuevo archivo (`customer-memory.server.ts`), import en 2 lugares | 2-3 funciones al inicio de `ai.server.ts` siguiendo el patrón existente | ~1 hora |
| **NO implementar Capa 2 (validación IA).** Solo Capa 1 con regex y umbral ≥ 0.6 | Prompt engineering + llamada IA extra + manejo de errores + timeout | ~40 líneas de regex en una función, guardado directo | ~2 días |
| **NO implementar cuarentena de señales débiles** | Buffer en memoria + lógica de promoción + cleanup por sesión | `if (confidence >= 0.6) save()` inmediato | ~4 horas |
| **NO implementar executive summary** (requiere llamada IA al final de conversación) | Detectar fin de conversación + llamar IA + guardar + manejar errores | Simplemente no hacerlo en V1 | ~1 día |
| **REUTILIZAR** `saveFocusedProduct()` y la sincronización a `crm_data` que ya existe | Ya implementado y probado en producción | Extender el JSONB con más campos para memoria | 0 (ya existe) |

## 5. Qué eliminar para una V1 más simple

| Componente del plan original | Decisión V1 | Razón |
|---|---|---|
| `customer_memory` tabla nueva | ❌ **ELIMINAR** | Usar `contacts.crm_data` existente |
| `customer-memory.server.ts` módulo separado | ❌ **ELIMINAR** | Funciones dentro de `ai.server.ts` |
| Capa 2 (validación IA) | ❌ **ELIMINAR** | Solo Capa 1 con regex, umbral ≥ 0.6 |
| Cuarentena de señales débiles | ❌ **ELIMINAR** | Guardado directo si cumple umbral |
| Executive summary | ❌ **ELIMINAR** | Requiere IA extra, poca ganancia en V1 |
| Perfil comercial (distribuidor vs consumidor) | ❌ **ELIMINAR** | Baja ocurrencia, agregar en V2 |
| History de cambios en preferencias | ❌ **ELIMINAR** | Solo mantener el último valor |
| Resolución de objeciones (resolved_at) | ❌ **ELIMINAR** | Solo append al array, sin marcar como resueltas en V1 |
| Cleanup worker programado | ❌ **ELIMINAR** | Hacerlo manualmente o en V2 |
| **Products viewed** (historial FIFO 50) | ✅ **MANTENER** | Máximo impacto, simple: array en `crm_data.product_history` |
| **Purchase intent** con historial | ✅ **MANTENER** | Mejorar columna existente `threads.purchase_intent` con objeto JSON |
| **Intereses** (categorías + keywords) | ✅ **MANTENER** | Array simple en `crm_data.interests`, sin scoring de confianza |
| **Preferencias** (color, material, tamaño, precio) | ✅ **MANTENER** | Objeto simple en `crm_data.preferences` |
| **Objeciones** (solo type + texto de la objeción) | ✅ **MANTENER** | Array simple en `crm_data.objections` |
| **Carga en prompt** como bloque de memoria | ✅ **MANTENER** | Es el entregable principal del proyecto |

## 6. Estimación realista de mejora en continuidad

| Escenario | Hoy | Con V1 | Mejora |
|---|---|---|---|
| Cliente vuelve al día siguiente | IA: "¿En qué puedo ayudarte?" (sin contexto) | IA: "Hola Juan, la última vez viste [producto]. ¿Qué te pareció?" | **Alta** |
| Cliente dijo "está caro" la semana pasada | IA vuelve a mostrar el producto y el cliente se frustra | IA: "Recuerdo que te pareció caro. Tenemos opciones más económicas en [categoría]." | **Alta** |
| Cliente pidió "algo negro" hace 3 días | IA recomienda productos aleatorios | IA filtra por color negro primero | **Media** |
| Cliente con 5 productos vistos en la última semana | IA empieza desde cero cada vez | IA reconoce que ya exploró varias opciones y pregunta por cuál decidió | **Media** |
| Cliente que ya compró | IA sigue ofreciendo productos como si nada | IA: "Gracias por tu compra anterior. ¿Necesitas algo más?" | **Baja** (no hay integración con órdenes aún) |

**Estimación global: 60-65% de mejora en continuidad percibida.**

Razones del techo del 65%:
- 10%: clientes que cambian de opinión entre sesiones (la memoria correcta se vuelve incorrecta)
- 10%: la IA ignora o malinterpreta el bloque de memoria en el prompt
- 10%: casos donde el mismo número de WhatsApp es usado por diferentes personas (teléfono compartido)
- 5%: límite de 500 caracteres en el bloque de memoria (no cabe toda la historia)
- 5%: mensajes del cliente que no alcanzan el umbral de confianza y no generan memoria

### Comparativa esfuerzo-beneficio

| Versión | Esfuerzo | Mejora esperada | Relación |
|---|---|---|---|
| Plan original (5 días, tabla nueva, 2 capas) | 5 días | ~70% | 14% mejora/día |
| **V1 simplificada (2 días, sin tabla nueva, 1 capa)** | **2 días** | **~62%** | **31% mejora/día** ✅ |

**La V1 entrega ~90% del beneficio con ~30% del esfuerzo.** La Capa 2 (validación IA) se puede agregar en V2 cuando haya datos históricos para medir su impacto real y ajustar los umbrales con evidencia.
