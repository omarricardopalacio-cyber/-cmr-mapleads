# Instrucciones para Ejecutar Migración del CHECK Constraint en ai_configs

> Nota importante: esta migración debe ejecutarse como SQL puro en el editor de Supabase. No pegues código de archivos TypeScript o JavaScript en el SQL editor; eso causa errores como `syntax error at or near "{"`.

## Problema
El constraint en la tabla `ai_configs` solo permitía los proveedores: 'lovable' y 'vertex'. Esto causa error al guardar configuraciones con OpenAI o Grok.

## Solución
Se debe ejecutar la migración SQL: `20260531_fix_ai_provider_constraint.sql`

Esta migración:
- ❌ Elimina el constraint antiguo restrictivo
- ✅ Añade uno nuevo que permite: 'lovable', 'vertex', 'openai', 'grok'

---

## OPCIÓN 1: Dashboard de Supabase (Recomendado - 2 minutos)

### Pasos:
1. Ir a: https://app.supabase.com
2. Seleccionar el proyecto **ntlkrlwllwxnanekclhw**
3. Ir a **SQL Editor** (panel izquierdo)
4. Crear una nueva query
5. Copiar y pegar el siguiente SQL:

```sql
-- Fix: Update ai_configs provider CHECK constraint to include openai and grok
-- This fixes the error when saving AI config with OpenAI or Grok providers

-- Drop old constraint
ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

-- Add new constraint with all 4 providers
ALTER TABLE ai_configs 
ADD CONSTRAINT ai_configs_provider_check 
CHECK (provider IN ('lovable','vertex','openai','grok'));
```

6. Click en **Run** (▶ botón azul)
7. ✅ Confirmar que la query se ejecutó correctamente
8. Guardar la query (para referencia futura)

---

## OPCIÓN 2: Script Node.js Local (Requiere credenciales de Supabase)

### Pasos:
1. Crear archivo: `scripts/execute-migration.js`

```javascript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // Necesario: obtener del dashboard

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runMigration() {
  try {
    console.log('🔄 Ejecutando migración de ai_configs...');
    
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
        ALTER TABLE ai_configs 
        ADD CONSTRAINT ai_configs_provider_check 
        CHECK (provider IN ('lovable','vertex','openai','grok'));
      `
    });
    
    if (error) throw error;
    console.log('✅ Migración completada exitosamente');
  } catch (error) {
    console.error('❌ Error ejecutando migración:', error.message);
    process.exit(1);
  }
}

runMigration();
```

2. Obtener `SUPABASE_SERVICE_ROLE_KEY`:
   - Dashboard Supabase → Settings → API
   - Copiar "service_role key"
   - Guardar en `.env.local`: `SUPABASE_SERVICE_ROLE_KEY=YOUR_KEY`

3. Ejecutar:
```bash
npm run build  # primero compilar el proyecto
node --loader tsx scripts/execute-migration.js
```

---

## OPCIÓN 3: Supabase Local + CLI (Requiere Docker)

### Requisitos:
- Docker Desktop instalado y corriendo
- Supabase CLI v2+

### Pasos:
```bash
# 1. Iniciar Supabase local
supabase start

# 2. Ejecutar migraciones
supabase db push

# 3. Ver logs
supabase status
```

---

## ✅ Validación Post-Migración

Después de ejecutar la migración, verificar en SQL Editor:

```sql
-- Ver constraint actual
SELECT constraint_name, constraint_definition 
FROM information_schema.table_constraints 
WHERE table_name = 'ai_configs' AND constraint_type = 'CHECK';

-- Debería mostrar:
-- ai_configs_provider_check | CHECK (provider = ANY (ARRAY['lovable'::text, 'vertex'::text, 'openai'::text, 'grok'::text]))
```

---

## 🎯 Siguiente Paso

Una vez completada la migración, podrás guardar Integraciones IA sin errores de constraint.

Prueba guardando una configuración con provider='openai' para confirmar que funciona.
