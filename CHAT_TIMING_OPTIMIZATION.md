# Optimización de Timing del Chat - Documento de Referencia

## Resumen de los fixes aplicados (2026-06-05)

Se han corregido dos problemas críticos que impedían que:
1. Las auto-respuestas se ejecutaran correctamente
2. El bot entre con el modo contextual correcto después de las auto-respuestas

### Fix 1: Tipo de retorno de `maybeAutoReply`
**Archivo:** `src/routes/api/public/engine/ingest.ts` (línea 257)

```typescript
// ANTES: retornaba totalDelaySec pero el tipo no lo especificaba
Promise<{ aiDisabled: boolean }>

// DESPUÉS: incluye totalDelaySec en el tipo
Promise<{ aiDisabled: boolean; totalDelaySec: number }>
```

**Impacto:** Permite que el sistema sepa cuánto tiempo esperó para auto-respuestas e inyecte la instrucción contextual correcta al bot.

### Fix 2: Respeto de `scheduled_for` en dispatcher de engine_commands
**Archivo:** `src/routes/api/public/engine/commands.ts` (línea 36-47)

```typescript
// ANTES: se enviaban TODOS los commands con status='pending'
const { data: pending } = await supabaseAdmin
  .from('engine_commands')
  .select('id, type, payload, attempts')
  .eq('session_id', session.id)
  .eq('status', 'pending')
  .order('created_at', { ascending: true })
  .limit(20)

// DESPUÉS: se filtran por scheduled_for
const now = new Date().toISOString()
const { data: pending } = await supabaseAdmin
  .from('engine_commands')
  .select('id, type, payload, attempts')
  .eq('session_id', session.id)
  .eq('status', 'pending')
  .or(`scheduled_for.is.null,scheduled_for.lte.${now}`)
  .order('created_at', { ascending: true })
  .limit(20)
```

**Impacto:** Evita que comandos programados (especialmente no-response) se ejecuten antes de su momento.

---

## Flujo de timing después de los fixes

```
┌─────────────────────────────────────────────────────────────────┐
│ Cliente envía mensaje a través de WhatsApp                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────┐
        │ POST /api/public/engine/ingest    │
        └──────────────────┬───────────────┘
                           │
        ┌──────────────────▼───────────────┐
        │ maybeAutoReply()                  │
        │ ├─ Busca reglas coincidentes     │
        │ ├─ Para cada regla que coincide: │
        │ │  ├─ Espera síncronamente (ms) │
        │ │  └─ Inserta command             │
        │ └─ Retorna totalDelaySec         │
        └──────────────────┬───────────────┘
                           │
        ┌──────────────────▼──────────────────┐
        │ maybeAiReply()                       │
        │ ├─ Recibe autoRepliesWereSent        │
        │ ├─ Si true: modo contextual (no se  │
        │ │   presenta, máx 1 pregunta)       │
        │ └─ Si false: modo normal            │
        └──────────────────┬──────────────────┘
                           │
        ┌──────────────────▼──────────────────────┐
        │ Schedule no-response pending entries     │
        │ (con scheduled_for = ahora + delay)     │
        └──────────────────┬──────────────────────┘
                           │
                    ◄──────┘ (fin de webhook)
                           
        ┌──────────────────────────────────┐
        │ Cliente llama GET /commands       │
        │ (para obtener mensajes a enviar)  │
        └──────────────────┬───────────────┘
                           │
        ┌──────────────────▼───────────────────┐
        │ SELECT pending commands donde:        │
        │ ├─ session_id = ?                     │
        │ ├─ status = 'pending'                 │
        │ └─ scheduled_for IS NULL OR           │
        │    scheduled_for <= now [NUEVO]       │
        └──────────────────┬───────────────────┘
                           │
        ┌──────────────────▼───────────────┐
        │ Retorna:                          │
        │ ├─ Auto-reply messages (enviados)│
        │ ├─ AI response                    │
        │ └─ EXCLUYE comandos futuros       │
        └──────────────────┬───────────────┘
                           │
                           ▼
        ┌──────────────────────────────────┐
        │ Cliente recibe y envía a WhatsApp │
        └──────────────────────────────────┘


[Después, cada 1-5 minutos]
        ┌──────────────────────────────────┐
        │ CRON no-response-worker           │
        │ ├─ Busca pending vencidos         │
        │ ├─ Valida que cliente no respondió
        │ └─ Encola commands con delays     │
        └──────────────────┬───────────────┘
                           │
        ┌──────────────────▼───────────────┐
        │ Próximos llamados a /commands     │
        │ retornarán los no-response msgs   │
        │ SOLO cuando scheduled_for venza   │
        └──────────────────────────────────┘
```

---

## Comparación: Antes vs Después

| Aspecto | ANTES (Roto) | DESPUÉS (Arreglado) |
|---------|---|---|
| `totalDelaySec` retornado | ❌ undefined | ✅ Número correcto |
| `autoRepliesWereSent` calculado | ❌ Siempre false | ✅ true si hubo delays |
| Bot entra con modo contextual | ❌ Nunca | ✅ Siempre que hay auto-replies |
| No-response se ejecuta temprano | ⚠️ Depende | ✅ Respeta scheduled_for |
| Auto-reply se encolaba | ✅ Sí | ✅ Sí |
| Auto-reply se enviaba | ❌ No llegaba a WhatsApp | ✅ Se envía correctamente |

---

## Optimizaciones futuras (opcional)

Si la demora de los `setTimeout()` síncronos en auto-replies es problemática:

### Opción A: Auto-replies asincronos (Cambio mayor)
```typescript
// En maybeAutoReply, en lugar de:
await new Promise((r) => setTimeout(r, waitTime * 1000));
await supabaseAdmin.from('engine_commands').insert({ ... })

// Hacer:
const scheduleAt = new Date(Date.now() + step.cooldown_seconds * 1000)
await supabaseAdmin.from('engine_commands').insert({
  ...payload,
  scheduled_for: scheduleAt  // Enviar al futuro
})
```

**Ventajas:** Webhook no se bloquea, más rápido
**Desventajas:** Auto-replies ya no se ejecutan "en orden" con relación al webhook

### Opción B: Paralelizar en lugar de secuencial
```typescript
// En lugar de for loop secuencial, usar Promise.all()
// CUIDADO: los delays se cumplirían en paralelo, no secuencial
```

### Opción C: Límites de delay para auto-replies
```typescript
// Si un auto-reply intenta esperar >5s, usar scheduled_for en su lugar
```

---

## Testing

### Test 1: Auto-replies funcionales
```bash
1. Crear auto-reply con trigger: "hola"
2. Enviar mensaje "hola" desde WhatsApp
3. Verificar que respuesta llegue
```

### Test 2: Modo contextual del bot
```bash
1. Crear auto-reply con 2s de delay
2. Crear auto-reply que diga "Holaa, buscas algo?"
3. Enviar "hola"
4. Bot debería NO decir "Soy asistente de..." sino continuar

Esperado:
Auto-reply: "Holaa, buscas algo?"
Bot (2 segundos después): "¿Qué puedo ayudarte?" (sin presentación)

Actual problema si fallaba: 
Bot entraba inmediatamente sin esperar al auto-reply
```

### Test 3: No-response respeta delays
```bash
1. Crear regla no-response con delay=600s (10 min)
2. Enviar mensaje, esperar 9 min
3. Verificar que no-response NO se envió
4. Esperar 1 min más
5. Verificar que se envió (cuando haya próximo polling)
```

---

## Debugging si aún hay problemas

### Si auto-replies NO se envían:
```typescript
// En ingest.ts, línea 1017, agregar log:
const { aiDisabled, totalDelaySec } = await maybeAutoReply(...)
console.log('[maybeAutoReply result]', { aiDisabled, totalDelaySec })

// Verificar:
✓ totalDelaySec > 0 cuando hay auto-reply
✓ maybeAutoReply no retorna undefined
```

### Si el bot entra demasiado rápido:
```typescript
// En ingest.ts, línea 1021, agregar log:
const autoRepliesWereSent = totalDelaySec > 0
console.log('[autoRepliesWereSent]', autoRepliesWereSent)

// Debería ser true si hubo auto-reply
```

### Si no-response se envía temprano:
```sql
-- En SQL Editor, verificar:
SELECT id, rule_id, fires_at, fired_at, created_at 
FROM no_response_pending 
ORDER BY created_at DESC 
LIMIT 10

-- Verificar que fired_at >= fires_at (nunca antes)
```

---

**Documento creado:** 2026-06-05
**Responsable de fixes:** Sistema de auditoría
**Última actualización:** Post-fix analysis
