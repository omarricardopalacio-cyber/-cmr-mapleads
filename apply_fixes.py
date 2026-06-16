#!/usr/bin/env python3
import re

with open('src/lib/ai.server.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 2: Proteger extractStructuredOrderData contra textos cortos
# Buscar el patrón y agregar validación
pattern2 = r'(if \(!text\?\.trim\(\)\) return out;\n    const fieldNames)'
replacement2 = r'''if (!text?.trim()) return out;
    // ✅ PROTECCIÓN: texto muy corto sin estructura (ej: "sí", "ok") no es volcado de datos
    if (text.trim().length < 10 && !/[:\-,\/\n]/.test(text)) {
      return out;
    }
    const fieldNames'''

content = re.sub(pattern2, replacement2, content)

# Fix 3: Proteger shouldConfirmOrderFromHistory  
pattern3 = r'(const isExplicitConf = isExplicitCustomerConfirmation\(lastUser\);\n    )(const isDump = isCollectingOrder && isDataDump\(\);)'
replacement3 = r'''\1// ✅ PROTECCIÓN: solo confirmar si hay datos reales
    \2 && (lastUser.length > 15 || /[:\-,\/\n]/.test(lastUser));'''

content = re.sub(pattern3, replacement3, content)

# Fix 4: Proteger recoverMissingOrderConfirmation
pattern4 = r'(const recoverMissingOrderConfirmation = async \(replyText: string\) => \{\s+if \(\s+!isOrderClaimWithoutConfirmation\(replyText\) \|\|\s+actions\.includes\("confirm_order"\) \|\|\s+orderConfirmed\s+\) \{\s+return false;\s+\}\s+)(const exec = await executeToolCall\()'

replacement4 = r'''\1// ✅ PROTECCIÓN: no inventar datos si el último mensaje no tiene estructura
    const lastUser = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
      .reverse()
      .find((m) => m.role === "user")
      ?.content?.trim() ?? "";
    
    const hasRealData = lastUser.length > 10 && /[:\-,\/\n]/.test(lastUser);
    if (!hasRealData) {
      return false;
    }

    \2'''

content = re.sub(pattern4, replacement4, content, flags=re.MULTILINE | re.DOTALL)

with open('src/lib/ai.server.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Cambios aplicados correctamente")
