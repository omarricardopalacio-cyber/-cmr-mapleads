const fd = {
  "Cel": "3503917880",
  "Nombre": "omar palacio",
  "Origen": "Recuperación automática: la IA confirmó el pedido sin ejecutar la herramienta confirm_order",
  "ciudad": "bogota",
  "Cantidad": "1",
  "Direccion": "calle 71 # 88 g 22 sur",
  "Registrado en": "2026-06-21T15:06:55.118Z",
  "Historial reciente": "Cliente: deseo informacion del COMBO SOLDADOR\nAsistente: Hola 👋 Gracias por contactarnos.\nAsistente: Soy parte del equipo de diselec\nAsistente: COMBO SOLDADOR\nPrecio: $69.900\nEstado: Nuevo\n\nDescripción:\nKit especializado para soldadores que reúne corte, limpieza, desbaste y acabado en una sola solución.\n\nIncluye:\n- 15 discos de corte\n- 5 discos de pulir\n- 5 discos flap\n- Grata copa lisa\n- Grata entorchada\n- Llave universal para amoladora\n- Adhesivo Maxon 120 cc\nAsistente: Dime de que ciudad te comunicas?\nAsistente: Claro que sí 😊 Con gusto te doy la información del COMBO SOLDADOR:\n\n📦 Nombre: COMBO SOLDADOR\n💲 Precio: $69.900\n✅ Beneficios principales: Kit especializado que reúne corte, limpieza, desbaste y acabado en una sola solución. Es ideal para soldadores, talleres metalmecánicos y mantenimiento industrial.\n\n¿Te gustaría saber algo más sobre este combo? 😊\nCliente: como lo pido para medellin\nAsistente: ¡Excelente elección! 😊 Para agendar tu pedido del COMBO SOLDADOR para Medellín, por favor indícame:\n\n*   Nombre\n*   Cel\n*   Dirección\n*   Cantidad\nCliente: que vale el envio\nAsistente: Realizamos envíos a nivel nacional por Interrapidísimo 😊\n\n🚚 Medellín: $18.000\n🚚 Bogotá y Soacha: $8.000\n\n¿Te gustaría que te calcule el total con envío? 😊\nCliente: cuanto me sale con envio\nAsistente: Permítame un momento, estoy confirmando su pedido. Ya casi terminamos... 😊\nCliente: ?\nAsistente: El total sería de $87.900 (COMBO SOLDADOR $69.900 + Envío a Medellín $18.000) 😊\n\n¿Con cuántas unidades del COMBO SOLDADOR deseas continuar? Además, por favor indícame tu nombre, número de celular y dirección para completar tu pedido.\nCliente: omar palacio /// 3503917880// calle 71 # 88 g 22 sur // bogota // cantidad 1",
  "Confirmación cliente": "omar palacio /// 3503917880// calle 71 # 88 g 22 sur // bogota // cantidad 1",
  "Resumen mostrado al cliente": "El total sería de $87.900 (COMBO SOLDADOR $69.900 + Envío a Medellín $18.000) 😊\n\n¿Con cuántas unidades del COMBO SOLDADOR deseas continuar? Además, por favor indícame tu nombre, número de celular y dirección para completar tu pedido.",
  "Respuesta de confirmación enviada": "Confirmación explícita del cliente"
};

const extractProductFromHistory = (visibleHistory) => {
  for (const m of [...visibleHistory].reverse()) {
    if (m.role !== "assistant") continue;
    const text = m.content || "";
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    
    let product;
    let price;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cleaned = line.replace(/^[\s*·•\-📦💲]+/g, '').trim();
      
      const nameMatch = cleaned.match(/^(nombre|producto|articulo|referencia|item)\s*[:\-]\s*(.+)$/i);
      if (nameMatch && !product) {
        const val = nameMatch[2].trim().replace(/^[\*\s]+|[\*\s]+$/g, '');
        if (val.length > 2 && val.length < 50) {
          product = val;
        }
      }
      
      const priceMatch = cleaned.match(/^(precio|valor|costo|total)\s*[:\-]\s*(.+)$/i);
      if (priceMatch && !price) {
        price = priceMatch[2].trim().replace(/^[\*\s]+|[\*\s]+$/g, '');
        
        if (!product && i > 0) {
          const prevLine = lines[i - 1].replace(/^[\s*·•\-📦]+/g, '').trim();
          if (prevLine.length > 2 && prevLine.length < 40 && !prevLine.includes(':') && !prevLine.includes('-')) {
            product = prevLine;
          }
        }
      }
    }
    
    if (product || price) {
      return { product, value: price };
    }
  }
  return {};
};

// Simulate visibleHistory properly: reconstruct messages from the text
const lines = fd["Historial reciente"].split('\n');
const visibleHistory = [];
let currentMsg = null;

for (const line of lines) {
  const m = line.match(/^(Cliente|Asistente):\s*(.*)$/);
  if (m) {
    if (currentMsg) {
      visibleHistory.push(currentMsg);
    }
    currentMsg = {
      role: m[1] === 'Cliente' ? 'user' : 'assistant',
      content: m[2]
    };
  } else {
    if (currentMsg) {
      currentMsg.content += '\n' + line;
    }
  }
}
if (currentMsg) {
  visibleHistory.push(currentMsg);
}

console.log('SIMULATED MESSAGES:');
visibleHistory.forEach((m, idx) => {
  console.log(`[${idx}] ${m.role.toUpperCase()}: ${m.content.slice(0, 100).replace(/\n/g, ' ')}...`);
});

console.log('\nResult of extractProductFromHistory:', extractProductFromHistory(visibleHistory));
