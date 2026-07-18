# Base de Conocimiento Actual

## Resumen
Este documento consolida lo que actualmente existe en el repositorio sobre la Base de Conocimiento, su arquitectura, las tablas de soporte y la forma en que se usa en el motor IA.

> Nota: en el repositorio no se encontró contenido de texto específico para las secciones listadas (por ejemplo, no hay entradas concretas de FAQ, políticas o guías de producto). Solo está disponible la definición de datos y la forma en que se consumen.

---

## 1. Estructura de Base de Conocimiento en el repositorio

### 1.1. Tablas relevantes
- `public.ai_configs`:
  - Campos: `org_id`, `enabled`, `provider`, `model`, `system_prompt`, `knowledge_base`, `respond_to`, `vertex_project`, `vertex_location`, `vertex_model`, entre otros.
  - Uso: `ai_configs.knowledge_base` almacena texto plano que se incluye directamente en el prompt de IA.

- `public.knowledge_sources`:
  - Definida en `supabase/migrations/20260531120000_flow_ai_configuration.sql`.
  - Campos principales:
    - `id`
    - `org_id`
    - `name`
    - `source_type` (tipos permitidos: `faq`, `products`, `services`, `catalog`, `pdf_document`, `website`, `internal_kb`, `custom_prompt`)
    - `content`
    - `metadata`
    - `is_active`
    - `created_at`, `updated_at`
  - Uso: guarda fuentes activas de conocimiento estructurado que el motor IA puede consultar y recortar según intención.

### 1.2. Soporte de configuración IA en `flows`
- La migración también agrega campos de IA a `public.flows`:
  - `ai_mode`, `ai_time_limit_minutes`, `ai_enabled_after_flow`, `ai_enabled_during_flow`, `ai_fallback_enabled`, `ai_transfer_on_failure`, `ai_maintain_context`, `ai_can_access_crm`, `ai_can_access_tags`, `ai_knowledge_sources`, `ai_transfer_rules`, `ai_custom_system_prompt`.
- Esto indica que la Base de Conocimiento puede integrarse no solo en un prompt global, sino también en flujos con fuentes específicas.

---

## 2. Cómo usa la IA la Base de Conocimiento

### 2.1. Uso de `knowledge_base`
- Localización: `src/lib/ai.server.ts`
- Lógica principal:
  - `cfg.knowledge_base` se limpia y se recorta a un máximo según el modo de prompt.
  - Se agrega como parte de la sección `=== BASE DE CONOCIMIENTO / PRODUCTOS ===` en el prompt del sistema.
- Fragmentos clave:
  - `const knowledgeBaseRaw = (cfg.knowledge_base as string)?.trim() || "";`
  - `const knowledgeBase = selectRelevantText(knowledgeBaseRaw, ...);`
  - `knowledgeBase ? `\n\n=== BASE DE CONOCIMIENTO / PRODUCTOS ===\n${knowledgeBase}` : ""`

### 2.2. Uso de `knowledge_sources`
- Localización: `src/lib/ai.server.ts`
- Funciona así:
  1. Carga `knowledge_sources` activas para la organización.
  2. Selecciona las fuentes relevantes según la intención del último texto del usuario (`selectRelevantKnowledgeSources`).
  3. Para cada fuente elegida, extrae el texto relevante mediante `selectRelevantText`.
  4. Añade bloques al prompt con encabezados como:
     - `[Tipo: ${ks.source_type} | Nombre: ${ks.name}]`
  5. Incluye en el prompt como:
     - `=== CONOCIMIENTO RELEVANTE ===` o `=== FUENTES DE CONOCIMIENTO ADICIONALES ===`
- Esto hace que la IA acceda a varias fuentes y no dependa solo de un campo de texto largo.

### 2.3. Reglas sobre la Base de Conocimiento
- Extraído de `src/lib/ai.server.ts`:
  - "Usa siempre la BASE DE CONOCIMIENTO / PRODUCTOS y el prompt del sistema como referencia prioritaria antes de inventar respuestas."
  - Si el cliente pregunta detalles no cargados, debe decir: "Ese dato exacto no lo tengo cargado, te lo verifico 😊".
  - En modo detalle de producto, debe usar el producto elegido y la Base de Conocimiento relevante.

---

## 3. Categorías listadas en la solicitud
Estas categorías no tienen contenido concreto en el repo, pero corresponden al esquema de `knowledge_sources` y al diseño de IA.

1. Nueva fuente
2. Confirmación de pedidos
3. Activo
4. Base de Conocimiento Interna
5. Impulso Comercial Inteligente
6. Flujo Conversacional de Venta Consultiva
7. Cálculo Inteligente de Entrega
8. Ventas Asistidas por Catálogo
9. Contexto Conversacional Inteligente
10. Interpretación de Intenciones del Pedido
11. Memoria Temporal del Pedido
12. Cálculo de Totales y Envíos
13. Proceso de Pedidos
14. Escalamiento y Atención
15. Preguntas Frecuentes
16. Reglas Multimedia
17. Política de Descuentos
18. Gestión de Objeciones
19. Venta Cruzada
20. Servicios
21. Información de Envíos
22. Motor de Recomendaciones
23. Presentación de Productos
24. Productos
25. Reglas de Catálogo
26. Catálogo
27. Personalidad Comercial

> Observación: Los elementos 2, 7, 12, 13 y 15 están alineados con la lógica de pedido y el prompt de IA. Los elementos 5, 6, 8, 9, 10, 11, 16, 18, 19 y 22 son temas que pueden mapearse a `knowledge_sources` con `source_type = internal_kb`, `faq`, `products`, `catalog`, `services` o `custom_prompt`.

---

## 4. Fuentes de código y archivos clave

- `src/lib/ai.server.ts`
  - Construcción de prompts IA
  - Reglas de conversación y flujo de pedido
  - Carga de `knowledge_sources`
  - Uso de `cfg.knowledge_base`

- `src/lib/ai.functions.ts`
  - Validación de `ai_configs`
  - Límite de longitud de `knowledge_base`

- `src/lib/automations.functions.ts`
  - CRUD de `knowledge_sources`
  - APIs para listar, crear, actualizar y borrar fuentes de conocimiento

- `supabase/migrations/20260531120000_flow_ai_configuration.sql`
  - Definición de la tabla `knowledge_sources`
  - Columnas IA en `flows`
  - Seguridad y políticas

- `supabase/migrations/20260605030000_fix_new_user_grants.sql`
  - Permisos para `knowledge_sources`

- `BOT_FLUJO_FIXES.md`
  - Observación crítica: la IA antes dependía del campo `knowledge_base` estático y por eso inventaba características cuando no tenía datos reales.

---

## 5. Estado actual de los datos en el repositorio
- No se encontró contenido de Base de Conocimiento propiamente dicho en archivos `.md`, `.sql`, `.json`, `.ts` o `.js` que corresponda a las categorías listadas.
- La implementación existente soporta:
  - `ai_configs.knowledge_base` como texto plano embebido en prompt.
  - `knowledge_sources` para múltiples fuentes de conocimiento con recorte por intención.
  - `ai_knowledge_sources` dentro de flujos (`flows`) para IA por flujo.

---

## 6. Recomendación para extraer la Base de Conocimiento real
Si deseas recuperar la Base de Conocimiento concreta, las opciones son:

- Obtener el contenido de `ai_configs.knowledge_base` desde la base de datos de la organización.
- Listar los registros activos de `public.knowledge_sources` por `org_id`.
- Revisar si hay una UI o API interna que permita exportar `knowledge_sources` y `ai_configs`.

---

## 7. Conclusión
Actualmente el repositorio contiene la definición y el flujo de uso de la Base de Conocimiento, pero no el texto específico de cada sección. Para tener un documento con el contenido real, hay que extraer los datos de la base de datos productiva o del seed de la organización.

> Archivo creado: `BASE_DE_CONOCIMIENTO_ACTUAL.md`
