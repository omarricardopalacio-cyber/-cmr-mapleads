export type KnowledgeSource = {
  name: string;
  source_type: string;
  content: string;
};

export type IntentMatch = {
  intent: string;
  matched: KnowledgeSource[];
};

export function selectRelevantKnowledgeSources(
  lastUserText: string,
  sources: KnowledgeSource[]
): IntentMatch | null {
  if (!lastUserText || !sources.length) return null;

  const query = lastUserText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Define intents and their keyword regexes
  const INTENT_RULES = [
    {
      intent: "compra_confirmacion",
      regex: /\b(compro|comprar|pedido|pedir|agendar|pago|pagar|metodo|metodos|transferencia|nequi|daviplata|efectivo|contraentrega|contra\s+entrega|enviar|envio|despacho|despachar|envian|mandar)\b/i,
      names: ["confirmacion", "pedido", "compra", "pago", "envio", "entrega"]
    },
    {
      intent: "producto_catalogo",
      regex: /\b(producto|productos|catalogo|modelo|modelos|precio|precios|stock|disponible|foto|fotos|imagen|imagenes|especificacion|especificaciones|material|voltaje|medidas|medida|tamaño|tamano|marca|garantia)\b/i,
      names: ["producto", "catalogo", "especificacion", "medida", "stock", "precio"]
    },
    {
      intent: "dudas_faq",
      regex: /\b(pregunta|preguntas|faq|duda|dudas|garantia|reclamo|devolucion|cambio|servicio|cliente|horario|horarios|direccion|ubicacion|tienda|fisica)\b/i,
      names: ["faq", "pregunta", "duda", "garantia", "horario", "ubicacion", "tienda"]
    },
    {
      intent: "venta_objeciones",
      regex: /\b(descuento|descuentos|rebaja|rebajas|barato|caro|costoso|promocion|promociones|combo|combos|garantia|seguro|confianza|estafa|seguro|original|copia|replica)\b/i,
      names: ["impulso", "venta", "objeciones", "comercial", "promocion", "descuento"]
    }
  ];

  for (const rule of INTENT_RULES) {
    if (rule.regex.test(query)) {
      const matched = sources.filter((ks) => {
        const ksName = ks.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const nameMatch = rule.names.some((n) => ksName.includes(n));
        return nameMatch;
      });

      if (matched.length > 0) {
        return {
          intent: rule.intent,
          matched
        };
      }
    }
  }

  return null;
}
