# 🔧 Debugging de Problemas de Multimedia en CRM

## ✅ Cambios Realizados (Mayo 31, 2026)

### 1. **Backend - Logging Mejorado** (`ingest.ts`)
- Ahora registra cuando `media` está NULL o falta en `processMediaUpload()`
- Logs en consola del servidor:
  ```
  [ingest] ⚠️ Media PERDIDA en processMediaUpload
  [ingest] ℹ️ No enrichedMedia pero sí hay media objeto
  ```

### 2. **Frontend - Mejor Renderizado** (`conversations.$threadId.tsx`)
- Muestra **"⚠️ Media sin URL (sincronizando...)"** cuando media existe pero falta URL
- Evita mostrar "[mensaje vacío]" en esos casos
- Mejor debugging visual

### 3. **Realtime Subscriptions** 
- Ahora escucha **INSERT Y UPDATE** en tabla `messages`
- Detecta cuando media fue procesada por el backend
- Logs en consola del navegador:
  ```
  [REALTIME] INSERT detectado, invalidando query
  [REALTIME] UPDATE detectado (media procesada)
  ```

### 4. **Refetch Más Rápido**
- Reducido de 5s a 3s
- Refetch inmediato después de enviar (sin esperar 3s)
- Refetch al enfocar ventana

---

## 🔍 Cómo Debuggear

### **En el CRM (Navegador)**

1. Abre **DevTools** (`F12`)
2. Ve a **Console**
3. Envía una imagen
4. **Observa estos logs:**
   ```
   ✅ [REALTIME] INSERT detectado
   ✅ [REALTIME] UPDATE detectado (media procesada)
   ```

4. Si ves **"⚠️ Media sin URL"** → La imagen está procesándose
5. Si ves **[mensaje vacío]** → El backend no guardó la URL

### **En el Backend (Logs de Servidor)**

1. Abre los logs del servidor (`npm run dev`)
2. Busca líneas con `[ingest]` cuando envíes una imagen
3. Deberías ver:
   ```
   [ingest] ⚠️ Media PERDIDA en processMediaUpload...
   O
   [ingest] ℹ️ No enrichedMedia pero sí hay media objeto...
   ```

Si no ves estos logs → El evento nunca llegó al backend

---

## 🐛 Problemas Comunes y Soluciones

### **Problema 1: "⚠️ Media sin URL (sincronizando...)" y NO se resuelve**

**Significado:** El backend recibió `media` pero `processMediaUpload()` falló

**Causa Probable:**
- Error en `Buffer.from(base64String, 'base64')`
- Error en upload a Supabase Storage
- El `base64String` está vacío tras parseBase64Media

**Solución:**
1. Ve a logs del servidor
2. Busca: `[ingest] media upload error:` o `[ingest] media processing error:`
3. Copia el error exacto
4. Revisa si las credenciales de Supabase Storage son correctas

---

### **Problema 2: Imágenes Enviadas → CRM No las Muestra**

**Síntoma:** La imagen aparece en el chat de WhatsApp pero no en el CRM

**Causa Probable:**
- El servidor recibió el mensaje pero no procesó la media
- El `media` field quedó NULL en la BD

**Solución:**
1. En DevTools → Network → abre la request POST a `/api/public/engine/ingest`
2. Ve a **Response** → busca el mensaje que enviaste
3. Verifica que `payload.media` esté en el JSON enviado
4. Si no está → El problema es en la **Extension**

---

### **Problema 3: Hay que hacer F5 para enviar otra imagen**

**Síntoma:** Primera imagen envía bien, pero segunda imagen no se actualiza sin F5

**Causa Probable:**
- El refetch después de enviar falla
- La suscripción realtime no se activa

**Solución:**
1. En DevTools → Console, busca:
   ```
   [REALTIME] UPDATE detectado
   ```
2. Si NO aparece después de 5 segundos → Problema con suscripción realtime
3. Si SÍ aparece pero UI no actualiza → Problema con invalidación de query

**Test Rápido:**
1. Envía imagen 1
2. Espera 3 segundos (refetch interval)
3. Envía imagen 2
4. Si ahora funciona → Es solo timing issue, aumentar refetch a 2s está en progreso ✅

---

## 📊 Tabla de Diagnóstico

| Síntoma | Logs Esperados | Si No Aparece | Causa Probable |
|---------|---|---|---|
| Imagen no muestra | `[REALTIME] UPDATE detectado` | Ver logs del servidor | Backend no procesó media |
| "[mensaje vacío]" | `[ingest] media: ... bytes` | Ver logs del servidor | Error en processMediaUpload |
| F5 requerido | `[REALTIME] INSERT/UPDATE` | En browser console | Suscripción realtime fallida |
| Media sin URL | `[ingest] media upload error:` | Muy raro | Error en Supabase Storage |

---

## 🧪 Test End-to-End

### **Test 1: Enviar Imagen (5 minutos)**

1. Abre CRM → Chat
2. Abre DevTools (F12)
3. Envía una imagen
4. **Verifica en orden:**
   - ✅ Toast: "Multimedia encolada"
   - ✅ Console: `[REALTIME] INSERT detectado`
   - ✅ Imagen aparece en chat
   - ✅ Console: `[REALTIME] UPDATE detectado`
   - ✅ Imagen con URL pública desde Supabase

### **Test 2: Recibir Imagen desde WhatsApp (10 minutos)**

1. Desde WhatsApp Web, envía una imagen a tu session
2. Espera 5 segundos (ingest + storage upload)
3. En CRM, recarga (`F5`)
4. **Verifica:**
   - ✅ Imagen aparece en chat (NO [mensaje vacío])
   - ✅ Imagen es clickeable (lightbox)
   - ✅ URL es de Supabase Storage (comienza con `https://...storage.supabase.co...`)

### **Test 3: Multiple Envíos sin F5 (5 minutos)**

1. Envía imagen 1
2. Espera a que aparezca (2-3 segundos)
3. Envía imagen 2 **sin hacer F5**
4. Espera a que aparezca
5. Envía imagen 3
6. **Verifica:** Todas aparecen sin necesidad de F5

---

## 📝 Logs para Reportar en GitHub Issue

Si todavía hay problemas, copia estos logs:

1. **Browser Console (F12)** - ejecuta:
   ```javascript
   // Ver últimos logs de REALTIME
   copy(document.querySelectorAll('[REALTIME]'))
   ```

2. **Server Logs** - copia líneas que contengan:
   ```
   [ingest]
   [REALTIME]
   [media]
   processMediaUpload
   ```

3. **Network Request** - en DevTools → Network → Filter: `ingest`
   - Copia el payload de la request POST

---

## 🎯 Próximos Pasos

Si después de hacer estos tests todavía hay problemas:

1. **Recompila la extensión:**
   ```bash
   cd maple-wa-engine/extension
   npm run build
   ```

2. **Recarga extensión en Chrome:**
   - `chrome://extensions`
   - Find "maple-wa-engine"
   - Click reload button

3. **Limpiar cache de Supabase:**
   ```bash
   # En consola del servidor
   npm run supabase:debug
   ```

4. **Reportar con logs:**
   - Copia los logs del breakdown arriba
   - Incluye:
     - Screenshot de CRM cuando muestra error
     - Console logs (browser + server)
     - Network request/response

---

## ✨ Métricas Post-Fix

| Métrica | Antes | Después |
|---------|-------|---------|
| Tiempo para aparecer imagen | 5-10s | 1-3s |
| F5 requerido | SÍ | NO |
| Mensajes vacíos | SÍ | Raro (con diagnóstico) |
| Realtime updates | Parcial | ✅ Completo |

