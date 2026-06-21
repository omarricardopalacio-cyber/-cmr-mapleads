// Test script to verify the improved regex memory extraction heuristics
function runCapa1Heuristics(userText, assistantReply) {
  const signals = [];
  const normalizedUser = userText.trim().toLowerCase();

  // Price objections
  if (/\b(caro|cara|caros|caras|costoso|costosa|costosos|costosas|elevado|elevada|elevados|elevadas|alto|altos|no me alcanza|no tengo plata|no tengo dinero|presupuesto|fuera de presupuesto|descuento|descuentos|rebaja|rebajas|menos precio|muy caro|muy cara)\b/i.test(normalizedUser)) {
    signals.push({
      type: "objection",
      subtype: "price",
      value: "precio",
      confidence: 0.8,
      reason: "Detectó palabras clave relacionadas a objeción de precio."
    });
  }

  // Shipping objections
  if (/\b(envio|envío|envios|envíos|domicilio|delivery|flete|fletes)\b/i.test(normalizedUser) && /\b(caro|costoso|alto|demora|tarda|tiempo|demora mucho|lejos)\b/i.test(normalizedUser)) {
    signals.push({
      type: "objection",
      subtype: "shipping",
      value: "envio",
      confidence: 0.8,
      reason: "Detectó palabras clave de envío junto a indicadores de costo/demora."
    });
  }

  // Decision/Time objections
  if (/\b(preguntar a mi|consultar con mi|hablar con mi|esposa|esposo|jefe|socio|pareja|pensarlo|considerarlo|despues|luego|más tarde|después)\b/i.test(normalizedUser)) {
    signals.push({
      type: "objection",
      subtype: "decision",
      value: "consulta",
      confidence: 0.8,
      reason: "Indica que requiere consultar la decisión con un tercero o tomar tiempo."
    });
  }

  // Trust/Security objections
  if (/\b(seguro|confiar|estafa|garantia|garantía|falso|original|referencias|dirección|dirección|fisica|física|tienda física|donde quedan|donde estan|dónde quedan|dónde están|es confiable)\b/i.test(normalizedUser)) {
    signals.push({
      type: "objection",
      subtype: "trust",
      value: "confianza",
      confidence: 0.8,
      reason: "Preguntas o preocupaciones sobre la seguridad, garantía o dirección física."
    });
  }

  // Preferences: Material
  const materialMatch = normalizedUser.match(/\b(madera|metal|plastico|plástico|vidrio|acero|hierro|aluminio|tela|cuero)\b/i);
  if (materialMatch) {
    signals.push({
      type: "preference",
      subtype: "material",
      value: materialMatch[1],
      confidence: 0.7,
      reason: `Preferencia de material: ${materialMatch[1]}`
    });
  }

  // Preferences: Color
  const colorMatch = normalizedUser.match(/\b(negro|negra|blanco|blanca|rojo|roja|azul|verde|gris|oscuro|oscura|claro|clara|beige|café|marrón|marron)\b/i);
  if (colorMatch) {
    signals.push({
      type: "preference",
      subtype: "color",
      value: colorMatch[1],
      confidence: 0.7,
      reason: `Preferencia de color: ${colorMatch[1]}`
    });
  }

  // Preferences: Size
  const sizeMatch = normalizedUser.match(/\b(grande|pequeño|pequeña|mediano|mediana|chico|chica|compacto|compacta|familiar|industrial|chicos|chicas)\b/i);
  if (sizeMatch) {
    signals.push({
      type: "preference",
      subtype: "size",
      value: sizeMatch[1],
      confidence: 0.6,
      reason: `Preferencia de tamaño: ${sizeMatch[1]}`
    });
  }

  // Interest detection keywords
  const interestKeywords = [
    { category: "catálogo", patterns: [/\b(catalogo|catálogo|catálogos|catalogos|portafolio|folleto|folletos|lista de precios)\b/i] },
    { category: "precio", patterns: [/\b(cuanto cuesta|precio|precios|valor|costo|costos|cuanto vale|cuánto cuesta|cuánto vale)\b/i] },
    { category: "información", patterns: [/\b(info|informacion|información|detalles|especificaciones|caracteristicas|características)\b/i] },
    { category: "fotos", patterns: [/\b(fotos|imagenes|imagen|foto|mostrar|mándame foto|mandame foto|mándame fotos|mandame fotos)\b/i] },
    { category: "envío", patterns: [/\b(envio|envío|envíos|envios|despacho|despachos|flete|fletes|delivery|entregas|entrega|cobertura)\b/i] },
    { category: "stock", patterns: [/\b(stock|disponibilidad|disponible|disponibles|tienen disponible|hay stock|tienen stock)\b/i] }
  ];

  for (const item of interestKeywords) {
    if (item.patterns.some(p => p.test(normalizedUser))) {
      signals.push({
        type: "interest",
        subtype: item.category,
        value: item.category,
        confidence: 0.8,
        reason: `Detectó interés en ${item.category} por palabras clave.`
      });
    }
  }

  // Intent / Stage detection (exploring / interested / ready (hot) / not_interested)
  let detectedIntent = null;
  let intentReason = "";

  if (/\b(no gracias|no quiero|no estoy interesado|no estoy interesada|ya no|cancela|cancelar|deja asi|deja así|luego veo|no me interesa|no me llama la atencion)\b/i.test(normalizedUser)) {
    detectedIntent = "not_interested";
    intentReason = "Heurística: Desinterés explícito.";
  } else if (/\b(como comprar|como compro|quiero comprar|queremos comprar|quiero pedir|queremos pedir|como pido|como pedimos|adquirir|llevar|llevarlo|llevarla|agendar|encargar|apartar|reservar|lo quiero|la quiero|los quiero|las quiero|lo compro|lo llevo|lo pido|pago|link de pago|metodo de pago|método de pago|donde pago|dónde pago|como pago|cómo pago|transferencia|tarjeta|efectivo|quiero ordenar|queremos ordenar|hacer pedido|hacer el pedido|enviar datos|enviar mis datos|dame la cuenta|datos de pago)\b/i.test(normalizedUser)) {
    detectedIntent = "ready"; // Stage: hot / ready
    intentReason = "Heurística: Intención clara de compra (pago, pedido, orden).";
  } else if (/\b(precio|cuanto cuesta|costo|valor|stock|disponibilidad|disponible|disponibles|talle|talla|tallas|color|colores|medida|medidas|info|informacion|información|detalles|especificaciones|fotos|mostrar|quiero ver|tienen)\b/i.test(normalizedUser)) {
    detectedIntent = "interested";
    intentReason = "Heurística: Interés en detalles específicos de productos (precio, stock, info).";
  } else if (signals.some(s => s.type === "objection" && s.subtype === "price")) {
    detectedIntent = "interested"; // Objections about price indicate some level of interest
    intentReason = "Heurística: Interés implícito a través de objeción de precio.";
  } else if (/\b(solo pregunto|solo curioseando|mirando|viendo|saber un poco|conocer|curioso|curiosa|hola|buenas)\b/i.test(normalizedUser)) {
    detectedIntent = "exploring";
    intentReason = "Heurística: Curioseando, saludo o exploración general.";
  }

  if (detectedIntent) {
    signals.push({
      type: "intent",
      subtype: "purchase_intent",
      value: detectedIntent,
      confidence: 0.8,
      reason: intentReason
    });
  }

  // Profile detection
  if (/\b(distribuidor|distribuidores|tienda|almacen|almacén|negocio|revendedor|revendedores|mayorista|mayoristas)\b/i.test(normalizedUser)) {
    signals.push({
      type: "profile",
      subtype: "customer_type",
      value: "comercial",
      confidence: 0.8,
      reason: "Perfil comercial (distribuidor/negocio/mayorista)."
    });
  }

  return {
    hasSignals: signals.length > 0,
    signals
  };
}

// Test cases
const testCases = [
  {
    input: "Hola, me interesa saber el precio de la mesa de madera blanca y si tienen en stock",
    expectedTypes: ["preference", "preference", "interest", "interest", "intent"]
  },
  {
    input: "Está demasiado caro para mi presupuesto, ¿no me haces un descuento?",
    expectedTypes: ["objection", "intent"] // price objection + interested
  },
  {
    input: "Quiero comprarla ya, pásame el link de pago o los datos de transferencia porfa",
    expectedTypes: ["intent"] // ready
  },
  {
    input: "Tengo que consultarlo con mi esposo primero y luego te aviso",
    expectedTypes: ["objection"] // decision
  },
  {
    input: "El costo de envío es muy elevado y además demora mucho la entrega",
    expectedTypes: ["objection"] // shipping
  },
  {
    input: "No gracias, ya no quiero comprar",
    expectedTypes: ["intent"] // not_interested
  },
  {
    input: "Somos mayoristas y queremos comprar para nuestra tienda de muebles",
    expectedTypes: ["profile", "intent"] // commercial profile + ready (because "queremos comprar" matched ready)
  }
];

console.log("=== RUNNING REGEX HEURISTIC TESTS ===");
let passed = 0;
for (const tc of testCases) {
  const result = runCapa1Heuristics(tc.input, "");
  console.log(`\nInput: "${tc.input}"`);
  console.log(`Signals detected:`, JSON.stringify(result.signals, null, 2));
  
  const detectedTypes = result.signals.map(s => s.type);
  const allFound = tc.expectedTypes.every(t => detectedTypes.includes(t));
  if (allFound) {
    console.log("✅ PASS");
    passed++;
  } else {
    console.log(`❌ FAIL - Expected to find types: ${tc.expectedTypes.join(", ")} but got: ${detectedTypes.join(", ")}`);
  }
}

console.log(`\nResultados: ${passed}/${testCases.length} pasados.`);
if (passed === testCases.length) {
  process.exit(0);
} else {
  process.exit(1);
}
