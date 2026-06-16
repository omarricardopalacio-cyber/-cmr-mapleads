# FASE 2A.3 — Reporte Maestro de Implementación

**Audiencia:** Dueño del proyecto / Director técnico  
**Propósito:** Convertir todos los análisis previos en un plan de ejecución real  
**Estado:** Sin implementar — solo diseño

---

## 1. Estado Actual

### Cómo funciona hoy el CRM

El CRM es un sistema que gestiona clientes y conversaciones de WhatsApp. Cada cliente tiene una ficha con datos básicos (nombre, teléfono, dirección). Las conversaciones se guardan como mensajes de texto dentro de "hilos" (threads). Los agentes humanos pueden ver el historial, etiquetar clientes, moverlos entre etapas de venta y asignarlos a otros agentes.

**Flujo básico:**
1. Cliente escribe por WhatsApp
2. El sistema recibe el mensaje
3. Busca o crea el cliente en la base de datos
4. Busca o crea el hilo de conversación
5. Decide quién responde: la IA o un humano

### Cómo funciona hoy la IA

La IA es un "asistente virtual" que recibe el mensaje del cliente, busca información relevante en varias fuentes y genera una respuesta. Funciona así:

1. Recibe el mensaje del cliente
2. Construye un "prompt" (instrucción gigante) que incluye:
   - El historial de los últimos 40 mensajes
   - La base de conocimiento de la empresa
   - El catálogo de productos
   - Reglas de comportamiento
3. Envía todo a un modelo de IA (Lovable, OpenAI, Vertex o Groq)
4. La IA decide qué hacer: responder, buscar productos, crear un pedido, etc.
5. Ejecuta la acción y envía la respuesta al cliente

**Problema:** Todo esto pasa en el mismo momento en que llega el mensaje. Si la IA tarda, el cliente espera. Si la IA falla, el sistema lo reintenta después.

### Cómo funciona hoy el catálogo

El catálogo de productos vive en una base de datos externa. El sistema la consulta cuando la IA necesita información de productos:

1. La IA pide buscar productos
2. El sistema consulta la base externa
3. Normaliza la búsqueda (corrige tildes, mayúsculas, typos)
4. Devuelve los resultados a la IA
5. La IA elige qué mostrar al cliente

### Cómo funciona hoy la base de conocimiento

Es un texto plano donde la empresa escribe información útil: políticas de envío, garantías, preguntas frecuentes, etc. Cuando la IA necesita responder, toma un fragmento relevante de ese texto (máximo 4000 caracteres) y lo incluye en el prompt.

**Problema:** La búsqueda es muy básica. Solo busca palabras clave. No entiende el significado de la pregunta. Si el cliente pregunta "¿cuánto tarda en llegar?" y la base de conocimiento dice "tiempos de entrega", el sistema puede no relacionarlos.

### Cómo funciona hoy la memoria (así llamada)

Hoy NO existe una memoria real. Solo hay:

- **`focused_product_snapshot`:** Un archivo temporal que guarda el último producto que se estaba viendo. Se pierde si la conversación cambia de tema.
- **`purchase_intent`:** Una etiqueta que dice si el cliente está comprando o no. Solo un texto: "compro", "no_compro", "collecting_data".

**Lo que NO existe hoy:**
- La IA no recuerda qué productos le gustaron al cliente en una conversación anterior
- La IA no sabe si el cliente ya dijo que algo era caro la semana pasada
- La IA no sabe si el cliente es comprador frecuente o primerizo
- La IA empieza cada conversación casi desde cero

---

## 2. Problemas Críticos

### 🔴 Alta — Pérdida de contexto

| Problema | Causa | Consecuencia |
|---|---|---|
| La IA olvida lo que pasó en conversaciones anteriores | No hay memoria persistente entre sesiones | Cada vez que el cliente vuelve, la IA no sabe quién es, qué quiere, qué vio antes |
| La IA olvida lo que pasó hace más de 40 mensajes | El historial se limita a 40 mensajes | Si la conversación es larga, la IA pierde el hilo |
| La IA no sabe si un producto ya lo mostró antes | Los productos mostrados se reconstruyen desde comandos de los últimos 30 minutos | Si el cliente vuelve al día siguiente, la IA muestra los mismos productos como si fueran nuevos |

### 🔴 Alta — Respuestas incorrectas

| Problema | Causa | Consecuencia |
|---|---|---|
| La IA dice "pedido registrado" sin haberlo registrado | El prompt tiene una regla que a veces la IA ignora | El cliente cree que compró pero el pedido no existe |
| La IA inventa respuestas cuando no encuentra información | El modelo de IA tiende a "alucinar" cuando no sabe | El cliente recibe información falsa sobre productos o políticas |
| La IA interpreta mal el tipo de cliente | Sin perfil comercial almacenado, trata a un distribuidor como cliente final | Precios, descuentos y condiciones incorrectas |

### 🟡 Media — Alucinaciones

| Problema | Causa | Consecuencia |
|---|---|---|
| La IA inventa características de productos | El catálogo no tiene información detallada de especificaciones | El cliente espera una característica que el producto no tiene |
| La IA inventa políticas de la empresa | La base de conocimiento está truncada a 4000 caracteres | El cliente recibe información incorrecta sobre garantías o envíos |
| La IA no sabe cuándo decir "no sé" | No hay una regla clara para que la IA admita ignorancia | La IA siempre intenta responder aunque no sepa |

### 🟡 Media — Lentitud

| Problema | Causa | Consecuencia |
|---|---|---|
| La IA se ejecuta en el mismo momento del mensaje | `ASYNC_AI_REPLY=false` | Si la IA tarda, el cliente ve un mensaje que nunca llega (timeout HTTP) |
| Todo el procesamiento está en un solo archivo gigante | `ingest.ts` (~1530 líneas) y `ai.server.ts` (~7000 líneas) | Cualquier cambio requiere tocar código frágil y difícil de mantener |
| No hay caché de respuestas | Cada consulta similar viaja al modelo de IA completo | Se gasta dinero y tiempo en repetir respuestas idénticas |

### 🟢 Baja — Inconsistencia

| Problema | Causa | Consecuencia |
|---|---|---|
| La IA se comporta diferente según el proveedor | Lovable, OpenAI, Vertex y Groq tienen comportamientos distintos | El cliente recibe respuestas de calidad variable según el proveedor que esté activo |
| No hay tests automáticos | Ninguna | Cada cambio puede romper algo sin que nadie se dé cuenta hasta que un cliente se queja |
| Varios archivos usan `@ts-nocheck` | TypeScript no puede detectar errores en esos archivos | Errores tontos (tipos incorrectos, nulls inesperados) llegan a producción |

---

## 3. Arquitectura Objetivo

### Las 3 Memorias

El sistema necesita **3 tipos de memoria** que trabajan juntas:

```
                    ┌─────────────────────────────┐
                    │       CLIENTE ESCRIBE       │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │       PROCESADOR           │
                    │  (decide qué memoria usar)  │
                    └──┬──────────┬──────────┬────┘
                       │          │          │
              ┌────────▼──┐ ┌────▼─────┐ ┌──▼────────┐
              │ MEMORIA 1 │ │ MEMORIA 2│ │ MEMORIA 3 │
              │Conver-   │ │ Cliente  │ │ Conoci-   │
              │sación    │ │          │ │ miento     │
              └────┬─────┘ └────┬─────┘ └────┬───────┘
                   │            │            │
                   ▼            ▼            ▼
              ┌──────────────────────────────────────┐
              │           IA (Modelo)               │
              │   (responde con toda la info)        │
              └──────────────────────────────────────┘
```

### MEMORIA 1 — Conversación (lo que ya existe, mejorado)

| Ahora | Futuro |
|---|---|
| Últimos 40 mensajes en el prompt | Últimos 40 mensajes + resumen automático de lo anterior si la conversación es larga |
| Productos mostrados últimos 30 minutos | Productos mostrados en TODA la conversación |
| Sin resumen de conversación | Resumen automático cuando la conversación termina |

**Qué guarda:** Los mensajes recientes + un resumen comprimido de la conversación completa.  
**Cómo se usa:** Se incluye siempre en el prompt de la IA.  
**Cuándo se actualiza:** En cada mensaje.  
**Problema que resuelve:** La IA no pierde el hilo en conversaciones largas.

### MEMORIA 2 — Cliente (NUEVA — esto es FASE 2A)

| Ahora | Futuro |
|---|---|
| Nada | Productos que ha visto (histórico completo) |
| Nada | Intereses detectados (categorías que le gustan) |
| Nada | Preferencias (colores, materiales, tamaños) |
| Nada | Objeciones (lo que no le gustó, lo que le pareció caro) |
| purchase_intent básico | Intención de compra con historial de cambios |
| Nada | Perfil comercial (distribuidor, consumidor final, etc.) |

**Qué guarda:** Todo lo relevante del cliente a través del tiempo.  
**Cómo se usa:** Se incluye en el prompt como "MEMORIA DEL CLIENTE" (texto breve, < 500 caracteres).  
**Cuándo se actualiza:** Después de cada mensaje relevante (no saludos ni respuestas cortas).  
**Problema que resuelve:** La IA reconoce al cliente aunque haya pasado una semana, sabe qué le gusta, qué le molestó, y puede retomar la venta donde quedó.

### MEMORIA 3 — Conocimiento (MEJORA de lo que existe)

| Ahora | Futuro |
|---|---|
| Texto plano truncado a 4000 caracteres | Base de conocimiento con búsqueda semántica (RAG) |
| Búsqueda por palabras clave | Búsqueda por significado (embedding + pgvector) |
| Una sola base de conocimiento | Múltiples fuentes: políticas, productos, FAQ, procedimientos |
| Sin actualización automática | Actualización programada desde documentos fuente |

**Qué guarda:** Información de la empresa: políticas, productos, FAQ, procedimientos.  
**Cómo se usa:** Se busca automáticamente el fragmento más relevante para la pregunta del cliente.  
**Cuándo se actualiza:** Cuando la empresa cambia sus políticas o agrega información.  
**Problema que resuelve:** La IA responde con información real y actualizada de la empresa, no inventa.

### Cómo interactúan las 3 memorias

```
Ejemplo: Cliente vuelve después de 5 días

1. MEMORIA 2 se activa primero
   → "Este cliente es distribuidor, vio estanterías metálicas, 
      le pareció caro el envío, su intención es 'interested'"

2. MEMORIA 1 complementa
   → "En su última visita vimos 3 productos: estante 3 niveles, 
      zapatero 6 niveles, organizador plástico"

3. MEMORIA 3 responde la pregunta actual
   → El cliente pregunta "siguen teniendo en stock?"
   → Busca en conocimiento: políticas de stock y disponibilidad
   → Encuentra: "stock actualizado cada 24 horas, consultar disponibilidad"

4. La IA combina todo y responde
   → "¡Hola de nuevo! Sí, tenemos las estanterías metálicas que vio la 
      semana pasada en stock. El envío a tu ciudad sale $15.000. 
      ¿Quieres agendar tu pedido?"
```

---

## 4. Plan de Implementación

### Paso 1: Preparación (Semana 1)

**Qué hacer:**
- Separar el archivo gigante `ingest.ts` en módulos más pequeños
- Separar `ai.server.ts` en: prompt-builder, tool-executor, memory-manager
- Eliminar los `@ts-nocheck` y corregir los tipos

| Dificultad | Riesgo | Beneficio |
|---|---|---|
| Alta (código muy acoplado) | Medio (puede romper cosas si no se prueba bien) | Hace posible todo lo demás. Sin esto, los siguientes pasos serán muy difíciles. |

**Resultado:** Código ordenado donde cada cosa está en su lugar. La memoria tendrá su propio archivo.

### Paso 2: Memoria del Cliente — Tabla y guardado básico (Semana 2)

**Qué hacer:**
- Crear la tabla `customer_memory`
- Crear la función que guarda productos vistos
- Crear la función que carga la memoria antes del prompt
- Guardar la intención de compra actualizada

| Dificultad | Riesgo | Beneficio |
|---|---|---|
| Baja (es una tabla nueva, no toca lo existente) | Bajo (es nuevo código, no modifica el actual) | Alto: la IA ya empieza a recordar productos y estado de compra entre conversaciones |

**Resultado:** La IA ya no empieza desde cero cada vez que el cliente vuelve.

### Paso 3: Extractor de Memoria — Solo Capa 1 (Semana 3)

**Qué hacer:**
- Implementar las reglas de detección por patrones (regex)
- Implementar filtros anti-falsos-positivos
- Implementar buffer de señales débiles
- Guardar intereses, preferencias y objeciones detectadas

| Dificultad | Riesgo | Beneficio |
|---|---|---|
| Media (hay que probar muchos patrones) | Bajo (solo agrega, no modifica) | Alto: la IA comienza a entender qué le gusta y qué no al cliente |

**Resultado:** La IA detecta automáticamente que al cliente le gusta X color, que Y producto le pareció caro, que prefiere Z material.

### Paso 4: Extractor de Memoria — Capa 2 con IA (Semana 4)

**Qué hacer:**
- Integrar validación por IA para señales candidatas
- Implementar resolución de conflictos (contradicciones)
- Mejorar precisión de la extracción

| Dificultad | Riesgo | Beneficio |
|---|---|---|
| Media (hay que elegir bien el modelo y prompt) | Bajo (la Capa 1 ya funciona, esta es mejora) | Alto: reduce falsos positivos de 30% a <5% |

**Resultado:** La memoria es precisa y confiable.

### Paso 5: RAG — Búsqueda Inteligente en Conocimiento (Semanas 5-6)

**Qué hacer:**
- Implementar pgvector en Supabase
- Generar embeddings de la base de conocimiento
- Reemplazar la búsqueda por palabras clave con búsqueda semántica
- Agregar múltiples fuentes de conocimiento

| Dificultad | Riesgo | Beneficio |
|---|---|---|
| Alta (requiere entender embeddings y pgvector) | Medio (cambia cómo se busca conocimiento) | Muy alto: la IA responde con información precisa, no inventa |

**Resultado:** La IA entiende la pregunta, busca el significado, no solo palabras. Responde con información real de la empresa.

---

## 5. Quick Wins (mejoras en menos de 1 día)

| # | Mejora | Tiempo | Impacto |
|---|---|---|---|
| 1 | Aumentar `HISTORY_WINDOW` de 40 a 60 mensajes | 5 minutos | La IA recuerda más contexto inmediato |
| 2 | Agregar más caracteres a la base de conocimiento (de 4000 a 6000) | 10 minutos | La IA tiene más información para responder |
| 3 | Agregar logging estructurado (reemplazar console.log) | 2 horas | Poder debuggear problemas en producción |
| 4 | Agregar timeout a `processRunUntilWaitOrCompleted` | 30 minutos | Evitar loops infinitos en flujos |
| 5 | Desactivar `@ts-nocheck` en 1 archivo a la vez y corregir tipos | 2-3 horas cada uno | TypeScript empieza a proteger contra errores |
| 6 | Agregar límite de tiempo global en runAiAgent | 1 hora | Evitar que una respuesta de IA cuelgue el sistema |

---

## 6. Riesgos — Qué NO tocar todavía

| # | No tocar | Por qué | Cuándo tocarlo |
|---|---|---|---|
| 1 | El archivo `ingest.ts` completo | Es monolítico pero FUNCIONA. Separarlo sin tests es peligroso. | Después de tener tests de integración |
| 2 | `ASYNC_AI_REPLY=true` (hacer IA asíncrona) | Cambia completamente el flujo de mensajes. Puede romper la experiencia en tiempo real. | FASE 3, después de colas |
| 3 | Cambiar de proveedor de IA principal | Cada proveedor se comporta distinto. Cambiar ahora = reintroducir bugs. | Solo si hay problemas de costo o calidad probados |
| 4 | Reemplazar la búsqueda de catálogo actual | Funciona y los clientes la usan. Puede tener fallos pero es conocida. | Después de RAG implementado y probado |
| 5 | Migrar la base de datos a otro esquema | Demasiados servicios dependen de las tablas actuales. | FASE 3, con migraciones planificadas |
| 6 | Agregar más de 3 fuentes de conocimiento | Más fuentes = más tokens = más costo y latencia. Mejor tener 3 buenas que 10 malas. | Cuando RAG esté maduro |

---

## 7. Orden Correcto de Construcción

### Diagrama de dependencias

```
PASO 1: Preparación
  └── No tiene dependencias
  └── Es requisito para todo lo demás
      
PASO 2: Memoria del Cliente (tabla + guardado básico)
  └── Depende de: Paso 1 (código ordenado)
  └── Es requisito para: Paso 3 y 4

PASO 3: Extractor Capa 1 (regex)
  └── Depende de: Paso 2 (la tabla existe)
  └── No depende de: Paso 4 (pueden ir en paralelo parcial)

PASO 4: Extractor Capa 2 (IA validación)
  └── Depende de: Paso 3 (la Capa 1 debe funcionar primero)
  
PASO 5: RAG (búsqueda semántica)
  └── No depende de Pasos 2-4 (es independiente)
  └── Puede ejecutarse en paralelo con Pasos 2-4 si hay 2 equipos
```

### Orden recomendado (1 equipo)

```
Semana 1:     ████████████████  PASO 1 (Preparación)
Semana 2:     ████████████████  PASO 2 (Memoria básica)
Semana 3:     ████████████████  PASO 3 (Extractor Capa 1)
Semana 4:     ████████████████  PASO 4 (Extractor Capa 2)
Semanas 5-6:  ████████████████████████████  PASO 5 (RAG)
```

### Orden alternativo (2 equipos)

```
Equipo A:
Semana 1:     ████████████████  PASO 1 (Preparación)
Semana 2:     ████████████████  PASO 2 (Memoria básica)
Semanas 3-4:  ████████████████████████████  PASO 5 (RAG)

Equipo B:
Semana 2:     ████████████████  PASO 3 (Extractor Capa 1)
Semana 3:     ████████████████  PASO 4 (Extractor Capa 2)

(Equipo B empieza en semana 2, después de que Paso 1 esté completo)
```

---

## 8. Recomendación Final

Si yo fuera el arquitecto principal del proyecto, este sería mi plan:

### La prioridad #1 es la MEMORIA DEL CLIENTE

No RAG, no búsqueda semántica, no IA asíncrona. **Memoria del cliente primero.** ¿Por qué? Porque hoy el problema más grave es que la IA no reconoce al cliente cuando vuelve. Un cliente que ya vio productos, ya preguntó precios, ya dijo qué le gusta, vuelve una semana después y la IA le pregunta "¿en qué puedo ayudarte?" como si fuera la primera vez. Eso es frustrante para el cliente y mata las ventas.

Con memoria del cliente, aunque sea básica (solo productos vistos + intención de compra), la IA puede decir:

> "Hola Juan, la última vez estábamos viendo el zapatero de 6 niveles. ¿Qué te pareció? ¿Quieres agendar tu pedido?"

Eso cambia la experiencia completamente.

### El camino más seguro

**No tocar lo que funciona.** Hoy el sistema recibe mensajes, la IA responde, los clientes compran. No está roto. Lo que falta es que sea más inteligente y consistente.

El enfoque correcto es **agregar capas sin romper las existentes**:

1. **Semana 1:** Solo ordenar el código. Pagar la deuda técnica. Duele pero es necesario.
2. **Semana 2:** Agregar la tabla de memoria. NO cambiar cómo funciona la IA todavía. Solo que empiece a guardar y leer memoria.
3. **Semana 3:** Enseñarle a la IA a detectar intereses y preferencias. Con patrones simples, sin IA aún.
4. **Semana 4:** Refinar con validación por IA. Hacer la memoria más precisa.
5. **Semanas 5-6:** Agregar búsqueda inteligente de conocimiento. La IA deja de inventar y empieza a responder con información real.

### ¿Qué pasa si solo podemos hacer una cosa?

Si solo hay tiempo y presupuesto para UNA mejora, que sea:

**CREAR LA TABLA DE MEMORIA Y GUARDAR PRODUCTOS VISTOS + INTENCIÓN DE COMPRA**

Eso solo, sin extractor, sin RAG, ya cambia el juego. La IA recordará:
- Qué productos vio el cliente
- En qué estado quedó la compra
- Cuál fue el último producto que le interesó

El extractor (detectar intereses, preferencias, objeciones) se puede agregar después. Pero la base de memoria, desde el día 1, ya da resultados.

### Resumen en 3 frases

1. **Primero la memoria del cliente** — que la IA sepa quién es el cliente cuando vuelve.
2. **Después el extractor** — que la IA aprenda sola qué le gusta y qué no al cliente.
3. **Al final el RAG** — que la IA deje de inventar y responda con información real de la empresa.

Cada paso se construye sobre el anterior. Cada paso se puede probar antes de pasar al siguiente. Cada paso agrega valor visible desde el día 1.

---

*Fin del reporte FASE 2A.3. Sin implementar — solo documento de planificación.*
