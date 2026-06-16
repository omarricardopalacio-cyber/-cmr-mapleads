# FASE 2A.2 — Extractor de Memoria del Cliente

**Arquitecto:** Senior IA Conversacional  
**Sistema:** CRM Conversacional WhatsApp + IA  
**Propósito:** Diseñar el extractor automático que analiza mensajes del cliente y detecta información relevante para la memoria persistente.

---

## Tabla de Contenido

1. Resumen Ejecutivo
2. Tipos de Memoria
3. Reglas de Extracción
4. Reglas de Actualización
5. Reglas de Eliminación
6. Manejo de Conflictos
7. Estrategia Anti-Falsos-Positivos
8. Flujo Completo
9. Casos de Ejemplo
10. Riesgos
11. Recomendación Final

---

## 1. Resumen Ejecutivo

El Extractor de Memoria es el componente encargado de analizar cada mensaje del cliente en tiempo real, identificar señales de memoria (intereses, preferencias, objeciones, intención de compra) y persistirlas en `customer_memory`.

**El extractor NO es un paso separado:** está integrado dentro del flujo de `runAiAgent()`. Aprovecha que la IA ya analizó el mensaje para ejecutar herramientas; al mismo tiempo, un analizador ligero (basado en patrones + IA) extrae señales de memoria del último mensaje del cliente.

**Arquitectura en 2 capas:**

| Capa | Velocidad | Precisión | Cuándo |
|---|---|---|---|
| **Capa 1: Regex + Heurísticas** | Instantáneo (< 1ms) | Media (70-80%) | Siempre, en cada mensaje |
| **Capa 2: Validación por IA** | 500-2000ms | Alta (90-95%) | Solo si Capa 1 detectó señal candidata |

La Capa 1 filtra el 90% de los mensajes irrelevantes. La Capa 2 solo se invoca cuando hay una señal candidata, usando un prompt ligero y barato (modelo rápido tipo Gemini Flash).

---

## 2. Tipos de Memoria

### 2.1 Intereses

| Subtipo | Descripción | Ejemplo |
|---|---|---|
| `product_category` | Categoría de producto | "busco estanterías", "quiero un zapatero" |
| `product_feature` | Característica específica | "de 6 niveles", "con ruedas" |
| `need` | Necesidad del cliente | "es para organizar mi taller" |
| `use_case` | Caso de uso | "para mi negocio", "para mi casa" |

### 2.2 Preferencias

| Subtipo | Descripción | Ejemplo |
|---|---|---|
| `color` | Color preferido | "negro", "blanco" |
| `material` | Material | "madera", "metal" |
| `size` | Tamaño | "grande", "pequeño" |
| `price_range` | Rango de precio | "menos de 50 mil", "económico" |
| `brand` | Marca | "JDM", "Genérico" |
| `style` | Estilo | "moderno", "rústico" |

### 2.3 Objeciones

| Subtipo | Descripción | Frase típica |
|---|---|---|
| `price` | Precio elevado | "está muy caro", "no me alcanza" |
| `shipping` | Costo/tiempo de envío | "el envío es muy caro", "tarde mucho" |
| `trust` | Desconfianza | "cómo sé que es original" |
| `timing` | Momento no adecuado | "ahora no puedo", "la próxima semana" |
| `quality` | Calidad dudosa | "se ve frágil", "es de buena calidad?" |
| `stock` | Disponibilidad | "tienen en stock?", "cuándo llega?" |
| `decision` | Necesita consultar | "tengo que preguntarle a mi esposa" |
| `comparison` | Comparando opciones | "déjame ver otras opciones" |

### 2.4 Intención de Compra

| Estado | Descripción | Señal |
|---|---|---|
| `exploring` | Navegando, sin urgencia | "qué tienen?", "muéstrame" |
| `interested` | Interés en producto específico | "me gusta ese", "cuánto vale?" |
| `ready` | Listo para comprar | "cómo lo pido?", "lo quiero" |
| `ordered` | Ya compró | "ya hice el pedido" |
| `abandoned` | Abandonó el proceso | "después te escribo" (y no volvió) |
| `not_interested` | No quiere comprar | "no gracias", "solo estaba viendo" |

### 2.5 Perfil Comercial

| Atributo | Descripción | Señal |
|---|---|---|
| `customer_type` | Tipo de cliente | "soy distribuidor", "es para mi tienda" |
| `urgency` | Nivel de urgencia | "lo necesito ya", "para mañana" |
| `budget_tier` | Nivel de presupuesto | "busco algo económico", "lo mejor" |
| `decision_role` | Rol en la decisión | "lo compro yo", "lo decide mi jefe" |
| `communication_style` | Estilo | Directo, dubitativo, entusiasta |
| `purchase_frequency` | Frecuencia | "compro cada mes" |

---

## 3. Reglas de Extracción

### 3.1 Capa 1: Patrones (Regex + Heurísticas)

Cada regla tiene: patrón, categoría de memoria, valor a extraer, nivel de confianza.

#### Intereses

| # | Patrón | Memoria | Valor | Confianza |
|---|---|---|---|---|
| I1 | `(?:busco|busco un|busco una|quiero|necesito|estoy buscando|estoy viendo|me interesa|me interesan|tienes|tiene|venden|manejan|hay)\s+(.{2,60})` | `interest.product_category` | El texto capturado | 0.8 |
| I2 | `(?:me gusta|me gustaron|me llamó la atención|me interesa ese|me interesa esa|me interesan los)\s+(.{2,60})` | `interest.product_category` | El texto capturado | 0.7 |
| I3 | `(?:es para|lo quiero para|la quiero para|necesito para|es con el fin de)\s+(.{2,60})` | `interest.use_case` | El texto capturado | 0.7 |
| I4 | Pregunta recurrente sobre misma categoría (>2 veces en 5 mensajes) | `interest.product_category` | Categoría detectada | 0.9 |

#### Preferencias

| # | Patrón | Memoria | Valor | Confianza |
|---|---|---|---|---|
| P1 | `(?:negro|blanca|blanco|rojo|roja|azul|verde|gris|oscuro|claro|beige|café|marron|marrón)` (adjetivo de color cerca de producto) | `preference.color` | Color normalizado | 0.7 |
| P2 | `(?:de|en)\s+(madera|metal|plástico|plastico|vidrio|acero|hierro|aluminio|tela|cuero)\s` (cerca de producto) | `preference.material` | Material normalizado | 0.7 |
| P3 | `(?:que sea|que sea de|tiene que ser|prefiero|quisiera|quisiera que sea|me gusta más)\s+(.{2,40})` | `preference.*` | Depende del contexto | 0.6 |
| P4 | `(?:económico|económica|barato|barata|más barato|cara|caro|económicos|económicas)` | `preference.price_range` | "economico" o "premium" según el adjetivo | 0.7 |
| P5 | `(?:grande|pequeño|mediano|chico|chica|compacto|familiar|industrial)` (referido a tamaño) | `preference.size` | Adjetivo normalizado | 0.6 |

#### Objeciones

| # | Patrón | Memoria | Valor | Confianza |
|---|---|---|---|---|
| O1 | `(?:está|está muy|está demasiado|es muy|es demasiado|muy)\s*(caro|cara|costoso|elevado|alto)` | `objection.price` | "precio" | 0.9 |
| O2 | `(?:no me alcanza|no tengo plata|no tengo dinero|se pasa de mi presupuesto|no me da el presupuesto|está fuera de mi presupuesto)` | `objection.price` | "presupuesto" | 0.9 |
| O3 | `(?:el envío|el domicilio|el delivery|el flete)\s+(?:es|sale|está)\s+(?:muy)?\s*(caro|costoso|elevado)` | `objection.shipping` | "costo_envio" | 0.9 |
| O4 | `(?:cuánto|cuanto)\s+(?:tarda|demora|se demora)\s+(?:el|la)\s+(?:envío|entrega|domicilio)` | `objection.shipping` | "tiempo_envio" | 0.6 |
| O5 | `(?:cómo sé|como sé|cómo se|cómo saber|estoy inseguro|me da desconfianza|no me convence|me preocupa)\s+(.{2,60})` | `objection.trust` | Texto capturado | 0.7 |
| O6 | `(?:ahora no|ahora no puedo|hoy no|en este momento no|esta semana no|estoy ocupado|estoy sin tiempo)` | `objection.timing` | "momento" | 0.8 |
| O7 | `(?:tengo que|debo|necesito)\s+(?:consultar|preguntar|hablar con|ver con|pensarlo|pensarla|decidir)` | `objection.decision` | "consulta" | 0.8 |
| O8 | `(?:déjame|déjeme|dejame|dejeme|voy a)\s+(?:ver|mirar|comparar|pensar|considerar)\s+(.{2,40})` | `objection.comparison` | Texto capturado | 0.7 |
| O9 | `(?:no me gusta|no me gustó|no me convence|no es lo que|no era lo que|esperaba algo|busco algo)\s+(.{2,60})` | `objection.quality` o `preference` | Texto capturado | 0.7 |
| O10 | `(?:tienen|hay|manejan)\s+(?:stock|disponible|existencia)` o `(?:se acabó|no hay|agotado|sin stock)` | `objection.stock` | "disponibilidad" | 0.7 |

#### Intención de Compra

| # | Patrón | Nuevo estado | Confianza |
|---|---|---|---|
| C1 | `(?:cómo|como|quiero|quisiera|deseo|necesito)\s+(?:comprar|pedir|ordenar|adquirir|llevar|agendar|encargar|apartar|reservar)\s+(.{2,60})` | `ready` | 0.9 |
| C2 | `(?:lo quiero|la quiero|lo compro|la compro|lo llevo|la llevo|lo pido|la pido|me lo llevo|dámelo|véndeme|véndamelo)` | `ready` | 0.9 |
| C3 | `(?:voy a|pienso|pensaba|estaba pensando|estaría|quisiera)\s+(?:comprar|pedir|adquirir|llevar)\s+(.{2,60})` | `interested` → `ready` | 0.7 |
| C4 | `(?:próxima|próximo|la otra|la que viene|el otro|el que viene)\s*(?:semana|mes|quincena)` | `interested` (con timing diferido) | 0.6 |
| C5 | `(?:no gracias|no quiero|no estoy interesado|solo estaba viendo|solo mirando|no, gracias|ya tengo|cambiar de opinión)` | `not_interested` | 0.9 |
| C6 | Silencio > 48h después de `ready` o `interested` | `abandoned` | 0.7 (por tiempo) |

#### Perfil Comercial

| # | Patrón | Memoria | Valor | Confianza |
|---|---|---|---|---|
| B1 | `(?:soy|somos|trabajo|trabajamos|represento)\s+(.{2,40})\s*(?:distribuidor|tienda|almacén|negocio|empresa|comerciante|revendedor|mayorista|minorista)` | `profile.customer_type` | "comercial" | 0.8 |
| B2 | `(?:lo necesito|lo quiero|urge|urgente|ya|para ayer|lo antes posible|lo más rápido|cuesta arriba)` | `profile.urgency` | "alta" / "baja" | 0.7 |
| B3 | `(?:lo decide|lo decide mi|lo consulto con|le pregunto a|lo hablo con|lo veo con)\s+(.{2,30})` | `profile.decision_role` | Texto capturado | 0.8 |

### 3.2 Capa 2: Validación por IA

Cuando la Capa 1 detecta una señal candidata, se envía un prompt ligero a la IA para validar y enriquecer:

```
Prompt: 
Analiza el mensaje del cliente y extrae datos para memoria persistente.
INPUT: "{mensaje}"
CONTEXTO: memoria actual = {resumen_memoria_actual}
Historial reciente (2 últimos mensajes IA + 1 último cliente):
{historial_cercano}

Responde SOLO si hay información relevante NUEVA o CAMBIADA.
Formato:
{
  "signals": [
    {
      "type": "interest|preference|objection|intent|profile",
      "subtype": "product_category|color|price|timing|...",
      "value": "valor extraído",
      "confidence": 0.0-1.0,
      "replace_existing": false,
      "reason": "por qué esto es relevante"
    }
  ]
}

Si no hay señales nuevas: { "signals": [] }
```

**Modelo recomendado:** `google/gemini-2.5-flash` (rápido, económico, bueno para extracción).

**Cuándo NO llamar Capa 2:**
- El mensaje es solo "sí", "no", "ok", "gracias", "👍"
- El mensaje es una respuesta a pregunta cerrada del agente
- No hubo señal candidata en Capa 1
- El cliente está en modo recolección de datos (no mezclar extracción mientras da datos de pedido)

---

## 4. Reglas de Actualización

### 4.1 Intereses

```
AL INSERTAR:
  Si interés con misma categoría ya existe:
    → incrementar mention_count + 1
    → actualizar last_updated_at
    → confidence = min(1.0, confidence * 1.1 + 0.05)
    → mergear keywords (sin duplicados)
  Si NO existe y hay espacio (< 10):
    → insertar nuevo con confidence base
  Si NO existe y no hay espacio (≥ 10):
    → reemplazar el de menor confidence (si nuevo confidence > viejo confidence)
```

### 4.2 Preferencias

```
AL INSERTAR:
  Si misma clave ya existe:
    → Si valor es IDÉNTICO: actualizar timestamp
    → Si valor es DIFERENTE:
        - Si nuevo tiene confianza ≥ 0.8: reemplazar
        - Si nuevo tiene confianza < 0.8: agregar como alternativa
        - Guardar historial de cambios (últimos 3 valores)
  Si clave nueva:
    → insertar
  Límite: 20 pares. Al exceder, eliminar pares sin cambios > 90 días.
```

### 4.3 Objeciones

```
AL INSERTAR:
  Si misma objeción (mismo tipo + misma semana):
    → incrementar contador de repetición
    → si repite > 3 veces: es OBJECIÓN FUERTE, priorizar
  Si misma objeción pero hace > 30 días:
    → insertar como nueva (pudo resolverse y reaparecer)
  Límite: 10 no resueltas. Al exceder, archivar la más antigua.
  Si cliente cambia de opinión explícitamente:
    → marcar como resolved con fecha y razón
```

### 4.4 Intención de Compra

```
AL INSERTAR:
  Transiciones permitidas:
    exploring → interested: siempre
    interested → ready: siempre
    ready → ordered: solo con confirm_order tool
    ready/como → abandoned: silencio > 48h
    interested → exploring: si el cliente cambia de tema radicalmente
    * → not_interested: solo si el cliente lo dice explícitamente
    abandoned → interested: si retoma después de días

  Transiciones NO permitidas (ignorar):
    ordered → exploring (ya compró, no retroceder)
    not_interested → ready (sin mensaje intermedio)
    
  FORZAR transición (override manual desde UI):
    Admin puede cambiar cualquier estado.
```

### 4.5 Perfil Comercial

```
AL INSERTAR:
  Si misma clave ya existe:
    → si nuevo valor es más específico, reemplazar
    → si nuevo valor contradice, guardar como nota (no reemplazar automáticamente)
  customer_type: nunca se reemplaza a "personal" después de "comercial"
    (un distribuidor siempre es distribuidor)
```

---

## 5. Reglas de Eliminación

### 5.1 Eliminación Automática (por tiempo)

| Memoria | Tiempo de retención | Acción |
|---|---|---|
| `products_viewed` > 90 días | Eliminar del array JSONB |
| `objections` resueltas > 30 días | Archivar (marcar `archived=true`) |
| `interests` con mention_count=1 y sin actividad > 60 días | Eliminar |
| `preferences` sin cambios > 180 días | Eliminar |
| Memoria completa sin conversación > 365 días | Soft-delete (marcar `archive=true`) |

### 5.2 Eliminación por Señal Explícita

| Señal del cliente | Acción |
|---|---|
| "ya no me interesa eso" | Eliminar interés específico |
| "cambié de opinión, quiero de madera" | Reemplazar preferencia |
| "el envío ya no es problema" | Resolver objeción de envío |
| "me equivoqué, sí me alcanza" | Resolver objeción de precio |

### 5.3 Eliminación Manual (desde UI)

- Botón "Eliminar interés" → borra interés específico
- Botón "Resolver objeción" → marca como resuelta
- Botón "Limpiar memoria" → borra todo y reinicia
- Botón "Editar" → modificación directa

---

## 6. Manejo de Conflictos

### 6.1 Información Contradictoria

| Conflicto | Estrategia |
|---|---|
| Cliente dice "busco negro" y luego "quiero blanco" | **Actualizar:** la preferencia más reciente gana. Guardar historial de cambios. |
| Cliente dice "me gusta" y "está caro" en el mismo mensaje | **Acumular:** registrar interés Y objeción. Son compatibles. |
| Cliente dice "no me interesa" pero vuelve a preguntar al día siguiente | **Priorizar acción sobre palabras:** si vuelve, es porque sí interesa. No marcar not_interested. |
| Interés detectado por Capa 1 y contradicho por Capa 2 | **Capa 2 gana** (tiene más precisión). |
| Dos intereses con misma categoría pero diferentes keywords | **Mergear:** unificar en un solo interés, combinar keywords. |
| Preferencia explícita vs comportamiento real | **Preferencia explícita gana.** Si dice "quiero negro" pero pregunta por productos blancos, la preferencia explícita es la señal más fuerte. |

### 6.2 Resolución de Conflictos

```
1. FUENTE: Capa 2 (IA) > Capa 1 (Regex)
2. RECENCIA: Mensaje más reciente > mensajes anteriores
3. EXPLÍCITO: Afirmación directa > inferencia
4. REPETICIÓN: Dicho 3+ veces > dicho 1 vez
5. ACCIÓN: Comportamiento > palabras sueltas
```

---

## 7. Estrategia Anti-Falsos-Positivos

### 7.1 Filtros de Exclusión

NO extraer memoria cuando:

| Situación | Razón |
|---|---|
| Cliente responde "sí", "no", "ok", "👍", "😊" | Sin información |
| Cliente está dando datos de pedido (collecting_data) | No mezclar con extracción de memoria |
| Mensaje es reply a pregunta cerrada del agente | No refleja interés genuino |
| Mensaje contiene solo números o selecciones ("la 3", "esa") | Es navegación, no preferencia |
| Mensaje es saludo o despedida ("hola", "gracias", "chao") | Sin valor de memoria |
| Mensaje fue enviado por el agente (direction='out') | Solo analizar mensajes del cliente |
| Cliente está en flujo automático (flow activo) | La memoria se distorsiona con mensajes del flow |
| Palabras clave aparecen en contexto negativo ("NO busco eso") | Invertir o ignorar según contexto |

### 7.2 Umbrales de Confianza

| Tipo | Mínimo para guardar | Mínimo para incluir en prompt |
|---|---|---|
| Intereses | 0.5 | 0.6 |
| Preferencias | 0.5 | 0.6 |
| Objeciones | 0.7 | 0.7 |
| Intención de compra | 0.6 | 0.7 |
| Perfil comercial | 0.6 | 0.7 |

### 7.3 Cuarentena de Señales Débiles

Las señales con confianza entre 0.3 y 0.5 no se guardan inmediatamente. Se acumulan en un buffer temporal dentro de la sesión:

```
BUFFER (en memoria volátil, dentro de runAiAgent):
  { type: "interest", category: "zapateros", confidence: 0.4, count: 1 }

Después de 3 ocurrencias de la misma señal débil en la misma conversación:
  → se promueve a memoria persistente con confidence = 0.6

Si la conversación termina sin promoción:
  → se descarta el buffer
```

### 7.4 Regla de Confirmación

Para memorias de alta importancia (cambio de intención de compra, objeción grave), se requiere **doble confirmación**:

```
1. Cliente dice "está muy caro" → señal candidata
2. En el mismo mensaje o el siguiente, el cliente NO se retracta
3. → Se guarda la objeción

Si en el siguiente mensaje el cliente dice "pero bueno, está bien el precio":
  → NO guardar la objeción
```

---

## 8. Flujo Completo

```
[CLIENTE] envía mensaje
    │
    ▼
INGEST.TS
    │
    ├─ ¿Es mensaje del cliente (direction='in')?
    │   Sí → continuar
    │   No  → FIN (no extraer)
    │
    ├─ ¿Está en modo collecting_data?
    │   Sí → NO extraer (puede interferir con datos de pedido)
    │   No  → continuar
    │
    ├─ ¿Es saludo/despedida/respuesta monosílaba?
    │   Sí → FIN (sin señales)

    │
    ▼
EXTRACTOR — CAPA 1 (Regex + Heurísticas)
    │
    ├─ Iterar sobre todas las reglas (I1..I4, P1..P5, O1..O10, C1..C6, B1..B3)
    ├─ Por cada match:
    │   ├─ Registrar señal candidata: { tipo, subtipo, valor, confianza_base, match_position }
    │   └─ Aplicar modificadores de confianza:
    │       ├─ ¿Está en contexto negativo? → confianza -= 0.3
    │       ├─ ¿Se contradice con mensaje anterior? → confianza -= 0.2
    │       ├─ ¿Es una repetición de señal previa en esta sesión? → confianza += 0.1
    │       └─ ¿El match es exacto (no substring)? → confianza += 0.1
    │
    ├─ ¿Hay al menos 1 señal con confianza ≥ 0.3?
    │   Sí → pasar a Capa 2
    │   No  → FIN (sin señales)
    │
    ▼
EXTRACTOR — CAPA 2 (Validación IA)
    │
    ├─ Construir prompt ligero con:
    │   ├─ mensaje del cliente
    │   ├─ señales candidatas de Capa 1
    │   ├─ memoria actual resumida
    │   └─ historial reciente (2 últimos intercambios)
    │
    ├─ Llamar modelo rápido (Gemini Flash / Lovable barato)
    │
    ├─ Parsear respuesta JSON
    │
    ├─ ¿Señales validadas?
    │   Sí → pasar a Actualizador
    │   No  → FIN (falso positivo descartado)
    │
    ▼
ACTUALIZADOR
    │
    ├─ Para cada señal validada con confianza ≥ umbral:
    │   ├─ Aplicar reglas de actualización (sección 4)
    │   ├─ Resolver conflictos con memoria existente (sección 6)
    │   └─ Persistir en customer_memory
    │
    ├─ Para señales con confianza entre 0.3-0.5:
    │   ├─ Agregar a buffer de sesión
    │   └─ Si count ≥ 3: promover a memoria persistente
    │
    └─ FIN
```

### Integración en el Pipeline Actual

El extractor se inserta dentro de `runAiAgent()`, después de que la IA procesa el mensaje pero antes de guardar la respuesta:

```ts
export async function runAiAgent({ orgId, threadId, contactId, messages, cfg }) {
  // ... (existente: cargar catálogo, thread, etc.)
  
  // NUEVO: Extraer memoria del último mensaje del cliente
  const lastClientMsg = messages.filter(m => m.role === 'user').pop();
  if (lastClientMsg && contactId) {
    await extractAndSaveMemory({
      orgId,
      contactId,
      threadId,
      lastMessage: lastClientMsg.content,
      isCollectingOrder,
      messages,          // para contexto
    });
  }
  
  // ... (existente: construir prompt, llamar IA, etc.)
}
```

### Carga en el Prompt

En el bloque `=== MEMORIA DEL CLIENTE ===` se incluye la memoria comprimida:

```
=== MEMORIA DEL CLIENTE ===
📋 Perfil: Cliente final (no comercial) | Urgencia: media
🎯 Interés principal: estanterías metálicas (fuerte) | también: organizadores (leve)
🎨 Preferencias: color negro, material metal, precio promedio
⚠️ Objeciones previas: costo de envío (NO resuelta)
💳 Intención: interested (último cambio: hace 2 días)
📦 Último producto visto: Estante 3 niveles metálico negro — $45.000
```

---

## 9. Casos de Ejemplo

### Caso 1: Interés + Preferencia

```
Cliente: "Estoy buscando un zapatero negro."

CAPA 1:
  I1: "estoy buscando un zapatero negro" → interest.product_category = "zapatero negro" (0.8)
  P1: "negro" cerca de "zapatero" → preference.color = "negro" (0.7)

CAPA 2 (validación):
  Confirma: interest.product_category = "zapateros", preference.color = "negro"

MEMORIA GUARDADA:
  interests: [{ category: "zapateros", keywords: ["zapatero"], confidence: 0.8 }]
  preferences: { color: "negro" }
  (purchase_intent no cambia: sigue exploring)
```

### Caso 2: Objeción de Precio

```
Cliente: "Me gusta pero está muy caro."

CAPA 1:
  I2: "me gusta" → interest.product_category (débil, depende de contexto)
  O1: "está muy caro" → objection.price (0.9)

CAPA 2 (validación):
  Confirma objeción de precio, pero detecta que el interés sigue existiendo.
  Nota: "interés Y objeción coexisten"

MEMORIA GUARDADA:
  objections: [{ type: "price", description: "dice que está muy caro", resolved: false }]
  interests: [+1 mention_count si el producto coincide con interés existente]
  (purchase_intent no cambia: sigue interested pero con objeción)
```

### Caso 3: Intención de Compra

```
Cliente: "Voy a comprar la próxima semana."

CAPA 1:
  C3: "voy a comprar" → intent.ready (0.7) pero con timing diferido
  → Modificador: "próxima semana" reduce urgencia

CAPA 2:
  Confirma: purchase_intent = ready, pero nota timing = "próxima semana"

MEMORIA GUARDADA:
  purchase_intent.current: "ready"
  purchase_intent.history: [{ status: "interested" → "ready", reason: "dijo que comprará la próxima semana" }]
  profile.urgency: "baja" (timing diferido)
```

### Caso 4: Falso Positivo (cliente negando)

```
Cliente: "NO busco estanterías."

CAPA 1:
  I1: "busco estanterías" → interest.product_category (0.8)
  → MODIFICADOR: contexto negativo → confianza -= 0.3 → 0.5

CAPA 2:
  Detecta negación → descarta señal

MEMORIA: (sin cambios)
```

### Caso 5: Múltiples señales en un mensaje

```
Cliente: "Soy distribuidor, busco estanterías metálicas grandes pero el envío a mi ciudad es muy caro."

CAPA 1:
  B1: "soy distribuidor" → profile.customer_type = "comercial" (0.8)
  I1: "busco estanterías metálicas grandes" → interest.product_category (0.8)
  P2: "metálicas" → preference.material = "metal" (0.7)
  P5: "grandes" → preference.size = "grande" (0.6)
  O3: "el envío es muy caro" → objection.shipping (0.9)

CAPA 2:
  Confirma todas las señales

MEMORIA GUARDADA:
  profile: { customer_type: "comercial" }
  interests: [{ category: "estanterías", keywords: ["metálicas", "grandes"], confidence: 0.8 }]
  preferences: { material: "metal", size: "grande" }
  objections: [{ type: "shipping", description: "envío a su ciudad es caro", resolved: false }]
```

### Caso 6: Contradicción

```
DÍA 1 - Cliente: "Quiero un zapatero negro."
  → memoria: preference.color = "negro"

DÍA 7 - Cliente: "¿Tienen zapateros blancos?"
  → Capa 2: detecta contradicción
  → Aplica regla: RECENCIA gana
  → memoria: preference.color = "blanco"
  → Se guarda historial: ["negro" → "blanco", cambio_detectado_en: DÍA 7]

Si el DÍA 8 el cliente vuelve a decir "negro":
  → memoria: preference.color = "negro" (vuelve al original)
  → Se incrementa peso de "negro"
```

---

## 10. Riesgos

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | **Capa 2 incrementa latencia** | Alta | Medio | Solo llamar Capa 2 si hay señal candidata (90% de los mensajes NO pasan). Modelo rápido (Gemini Flash). Timeout de 1s. |
| R2 | **Falsos positivos en Capa 1 contaminan memoria** | Alta | Medio | Capa 2 filtra ~80% de falsos positivos. Cuarentena para señales débiles. |
| R3 | **Capa 2 falla (timeout/error)** | Media | Bajo | Si Capa 2 falla, la señal de Capa 1 se guarda SOLO si confianza ≥ 0.8 (alta). |
| R4 | **Cliente cambia de opinión y memoria no se actualiza** | Media | Alto | Regla de recencia: el último mensaje gana. Si dice algo diferente, se actualiza. |
| R5 | **Sobre-carga de escrituras en DB** | Alta | Bajo | Bufferizar escrituras: acumular cambios y persistir cada 3 mensajes o al final de la conversación. |
| R6 | **Extraer datos sensibles sin querer** | Baja | Alto | Lista negra de patrones: números de tarjetas, documentos, direcciones exactas. NO extraer como preferencias. |
| R7 | **La IA usa memoria de cliente A para cliente B (session cross)** | Baja | Crítico | Siempre filtrar por org_id + contact_id. Nunca cargar memoria sin validar ambos. |
| R8 | **Costo de API para Capa 2** | Media | Bajo | ~10-20% de mensajes pasan a Capa 2. Cada llamada ~100 tokens. Costo estimado: $0.50/mes por cada 10k conversaciones. |

---

## 11. Recomendación Final

### Arquitectura Recomendada

```
                  ┌──────────────────────┐
                  │    Mensaje Cliente    │
                  └──────────┬───────────┘
                             │
                    ┌────────▼────────┐
                    │  FILTRO RÁPIDO  │ ← ¿Saludo? ¿Sí/No? ¿Collecting data?
                    │  (exclusiones)  │
                    └────────┬────────┘
                             │ (pasa)
                    ┌────────▼────────┐
                    │   CAPA 1: REGEX │ ← 5-10 reglas por tipo de memoria
                    │  (heurísticas)  │     ≈ 40 reglas total
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  ¿Señal ≥ 0.3? │──No──→ FIN
                    └────────┬────────┘
                             │ (sí)
                    ┌────────▼────────┐
                    │   CAPA 2: IA    │ ← Gemini Flash, prompt ligero
                    │  (validación)   │     timeout 1s
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  ACTUALIZADOR   │ ← mergear, resolver conflictos
                    │  (reglas lógicas)│     bufferizar escrituras
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  customer_memory│
                    │  (persistencia) │
                    └─────────────────┘
```

### Orden de Implementación

1. **Capas 1 + Filtros + Actualizador** (día 1-3): Solo regex, sin IA. Captura ~70% de señales útiles con 0 falsos positivos (usando umbrales altos).
2. **Cuarentena + Buffer** (día 4): Reduce ruido de señales débiles.
3. **Capa 2 (IA)** (día 5-6): Agrega validación, mejora precisión a ~90%.
4. **Resolver conflictos + Reglas avanzadas** (día 7): Manejo de contradicciones, mergeo.
5. **Monitoreo y refinamiento** (día 8+): Dashboard de señales detectadas vs relevantes, ajuste de patrones.

### Costo de Implementación Estimado

| Componente | Esfuerzo | Complejidad |
|---|---|---|
| Capa 1 (regex + heurísticas) | 2-3 días | Media |
| Capa 2 (integración IA validación) | 1-2 días | Media |
| Actualizador (merge, conflictos) | 1-2 días | Alta |
| Buffer de cuarentena | 0.5 días | Baja |
| Tests + refinamiento | 2-3 días | Media |
| **Total** | **~7-10 días** | |

---

*Fin del diseño FASE 2A.2 — Extractor de Memoria. Sin implementar — solo documento de diseño.*
