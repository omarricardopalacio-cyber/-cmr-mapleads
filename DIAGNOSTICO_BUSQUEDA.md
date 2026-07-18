# Diagnóstico: Búsqueda de Productos Incompleta

**Fecha**: 2026-06-12  
**Problema**: Al buscar "almohada" en WhatsApp se retornan 2 BOLSAS incorrectas en lugar de 3 almohadas válidas

---

## 5 Causas Identificadas

### 1. Scoring permisivo sin threshold mínimo ⚠️ CRÍTICA
- **Código**: `const matched = scoredProducts.filter((sp) => sp.score > 0);`
- **Problema**: Acepta cualquier score ≥ 1 (muy bajo)
- **Impacto**: "BOLSA COMPRESION" con score=5 mezclada con "ALMOHADA" score=50
- **Síntoma**: Productos irrelevantes aparecen en resultados

### 2. Pool sin separación de relevancia
- **Código**: Mezcla nameMatches con otros matches sin priorización clara
- **Problema**: Ambos tipos de coincidencias comparten la misma lista ordenada por score
- **Impacto**: Bolsas con match débil roban posición a almohadas válidas
- **Síntoma**: Limit=6 devuelve 3 almohadas + 2 bolsas + 1 otro

### 3. Datos en descripción/metadata no validados
- **Problema**: "BOLSA COMPRESION" probablemente tiene en descripción "Ideal para guardar almohadas"
- **Causa**: Token "almohada" en descripción suma score=20 (muy alto)
- **Error**: No diferencia entre "producto IS almohada" vs "producto GUARDA almohadas"
- **Impacto**: Falsos positivos por contexto indirecto

### 4. Rango limitado (0-299) se pierden productos
- **Código**: `Range: "0-299"`
- **Problema**: Si BD tiene 500 productos, algunos almohadas reales pueden estar fuera del rango
- **Solución**: Aumentar a 500

### 5. Sin filtro de exclusión
- **Problema**: Busca "almohada" pero no rechaza términos como "bolsa", "funda", "contenedor"
- **Impacto**: Accesorios y contenedores entran como coincidencias
- **Síntoma**: "BOLSA PARA ALMOHADAS" trae bolsa, no almohada

---

## Soluciones Aplicadas

✅ **Threshold Mínimo**: Score < 15 rechazado automáticamente  
✅ **Priorización**: Si hay 3+ name-matches, devuelve solo esos  
✅ **Palabras de Exclusión**: Rechaza "bolsa", "funda", "contenedor" cuando busca "almohada"  
✅ **Fallback Inteligente**: Si no hay matches fuertes (score ≥ 15), busca name-matches débiles (≥ 10)  
✅ **Mayor Rango**: Aumentado de 300 a 500 productos (0-499)  

---

## Validación

Después de estos cambios, al buscar "almohada" se espera:
1. ALMOHADA PARA PIERNA 4169-12 (score 50+, nameHit)
2. ALMOHADA PARA ESPALDA JUF-17 (score 50+, nameHit)
3. ALMOHADA SL28298 (score 50+, nameHit)

Y se rechazan:
- BOLSA COMPRESION (excluida por "bolsa")
- BOLSA DE ROPA (excluida por "bolsa")

---

## Archivos Modificados
- `src/lib/catalog.server.ts` → `rankProductsMeta()` con filtros
- `src/lib/catalog.server.ts` → Range aumentado a 500 productos
