import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ProductViewed {
  product_id: string;
  name: string;
  price?: number;
  category?: string;
  viewed_at: string;
  source: string;
}

export interface Interest {
  category: string;
  keywords: string[];
  confidence: number;
  first_detected_at: string;
  last_updated_at: string;
  mention_count: number;
}

export interface Objection {
  type: string;
  description: string;
  mentioned_at: string;
  resolved: boolean;
  resolved_at?: string | null;
}

export interface PurchaseIntent {
  current: "exploring" | "interested" | "ready" | "ordered" | "abandoned" | "not_interested";
  history: Array<{
    status: string;
    changed_at: string;
    reason: string;
  }>;
  last_product_id?: string;
}

export interface CustomerMemory {
  executive_summary?: string;
  products_viewed?: ProductViewed[];
  interests?: Interest[];
  preferences?: Record<string, string>;
  objections?: Objection[];
  purchase_intent?: PurchaseIntent;
  metrics?: {
    total_conversations: number;
    last_conversation_at: string | null;
  };
}

export interface CandidateSignal {
  type: "interest" | "preference" | "objection" | "intent" | "profile";
  subtype: string;
  value: string;
  confidence: number;
  reason: string;
}

export interface Msg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

/**
 * Loads the commercial memory from contacts.ai_memory
 */
export async function loadCustomerMemory(orgId: string, contactId: string): Promise<CustomerMemory> {
  const defaultMemory: CustomerMemory = {
    executive_summary: "",
    products_viewed: [],
    interests: [],
    preferences: {},
    objections: [],
    purchase_intent: { current: "exploring", history: [] },
    metrics: { total_conversations: 0, last_conversation_at: null }
  };

  try {
    const { data, error } = await (supabaseAdmin as any)
      .from("contacts")
      .select("ai_memory")
      .eq("id", contactId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (error) {
      console.error("[customer-memory] Error querying contacts table:", error);
      return defaultMemory;
    }

    if (!data || !data.ai_memory) {
      return defaultMemory;
    }

    const rawMemory = data.ai_memory as Record<string, any>;
    return {
      executive_summary: rawMemory.executive_summary || "",
      products_viewed: Array.isArray(rawMemory.products_viewed) ? rawMemory.products_viewed : [],
      interests: Array.isArray(rawMemory.interests) ? rawMemory.interests : [],
      preferences: rawMemory.preferences && typeof rawMemory.preferences === "object" ? rawMemory.preferences : {},
      objections: Array.isArray(rawMemory.objections) ? rawMemory.objections : [],
      purchase_intent: {
        current: rawMemory.purchase_intent?.current || "exploring",
        history: Array.isArray(rawMemory.purchase_intent?.history) ? rawMemory.purchase_intent.history : [],
        last_product_id: rawMemory.purchase_intent?.last_product_id
      },
      metrics: {
        total_conversations: Number(rawMemory.metrics?.total_conversations) || 0,
        last_conversation_at: rawMemory.metrics?.last_conversation_at || null
      }
    };
  } catch (err) {
    console.error("[customer-memory] loadCustomerMemory unexpected error:", err);
    return defaultMemory;
  }
}

/**
 * Formats the memory object into a concise text block for the system prompt
 */
export function formatMemoryForPrompt(memory: CustomerMemory): string {
  const parts: string[] = [];

  if (memory.executive_summary) {
    parts.push(`📋 Resumen Ejecutivo: ${memory.executive_summary}`);
  }

  if (memory.purchase_intent?.current) {
    parts.push(`💳 Intención de Compra: ${memory.purchase_intent.current}`);
  }

  if (memory.preferences && Object.keys(memory.preferences).length > 0) {
    const prefs = Object.entries(memory.preferences)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    parts.push(`🎨 Preferencias del Cliente: ${prefs}`);
  }

  if (memory.interests && memory.interests.length > 0) {
    const topInterests = [...memory.interests]
      .sort((a, b) => b.confidence - a.confidence || b.mention_count - a.mention_count)
      .slice(0, 5)
      .map(i => `${i.category} (${i.keywords.join(", ")})`)
      .join(", ");
    if (topInterests) {
      parts.push(`🎯 Intereses Detectados: ${topInterests}`);
    }
  }

  if (memory.objections && memory.objections.length > 0) {
    const activeObjections = memory.objections
      .filter(o => !o.resolved)
      .map(o => `${o.type}: ${o.description}`)
      .join("; ");
    if (activeObjections) {
      parts.push(`⚠️ Objeciones Activas: ${activeObjections}`);
    }
  }

  if (memory.products_viewed && memory.products_viewed.length > 0) {
    const lastProducts = memory.products_viewed
      .slice(-5)
      .reverse()
      .map(p => `${p.name}${p.price ? ` ($${p.price})` : ""}`)
      .join("\n- ");
    if (lastProducts) {
      parts.push(`📦 Últimos Productos Vistos:\n- ${lastProducts}`);
    }
  }

  return parts.join("\n");
}

/**
 * Saves the memory object to contacts.ai_memory, performing a clean deep merge.
 */
export async function saveCustomerMemory(orgId: string, contactId: string, memory: CustomerMemory): Promise<void> {
  try {
    // 1. Load current memory from DB to prevent overwriting keys
    const currentMemory = await loadCustomerMemory(orgId, contactId);
    const nowStr = new Date().toISOString();

    // 2. Perform safe merge
    const mergedMemory: CustomerMemory = {
      executive_summary: memory.executive_summary !== undefined ? memory.executive_summary : currentMemory.executive_summary,
      preferences: {
        ...(currentMemory.preferences || {}),
        ...(memory.preferences || {})
      },
      metrics: {
        total_conversations: memory.metrics?.total_conversations !== undefined
          ? memory.metrics.total_conversations
          : (currentMemory.metrics?.total_conversations || 0),
        last_conversation_at: memory.metrics?.last_conversation_at || currentMemory.metrics?.last_conversation_at || nowStr
      },
      purchase_intent: {
        current: memory.purchase_intent?.current || currentMemory.purchase_intent?.current || "exploring",
        history: mergePurchaseHistory(currentMemory.purchase_intent?.history, memory.purchase_intent?.history),
        last_product_id: memory.purchase_intent?.last_product_id || currentMemory.purchase_intent?.last_product_id
      }
    };

    // Merge Products (max 50)
    const currentProducts = currentMemory.products_viewed || [];
    const newProducts = memory.products_viewed || [];
    const mergedProducts = [...currentProducts];
    for (const prod of newProducts) {
      if (!mergedProducts.some(p => p.product_id === prod.product_id && p.viewed_at === prod.viewed_at)) {
        mergedProducts.push(prod);
      }
    }
    mergedMemory.products_viewed = mergedProducts.slice(-50);

    // Merge Interests (max 10)
    const currentInterests = currentMemory.interests || [];
    const newInterests = memory.interests || [];
    const mergedInterests = [...currentInterests];
    for (const interest of newInterests) {
      const idx = mergedInterests.findIndex(i => i.category.toLowerCase() === interest.category.toLowerCase());
      if (idx !== -1) {
        const existing = mergedInterests[idx];
        const uniqueKeywords = Array.from(new Set([...existing.keywords, ...interest.keywords]));
        mergedInterests[idx] = {
          category: existing.category,
          keywords: uniqueKeywords,
          confidence: Math.max(existing.confidence, interest.confidence),
          first_detected_at: existing.first_detected_at || interest.first_detected_at || nowStr,
          last_updated_at: interest.last_updated_at || nowStr,
          mention_count: (existing.mention_count || 0) + (interest.mention_count || 1)
        };
      } else {
        mergedInterests.push(interest);
      }
    }
    mergedMemory.interests = mergedInterests
      .sort((a, b) => b.confidence - a.confidence || b.mention_count - a.mention_count)
      .slice(0, 10);

    // Merge Objections (max 10)
    const currentObjections = currentMemory.objections || [];
    const newObjections = memory.objections || [];
    const mergedObjections = [...currentObjections];
    for (const objection of newObjections) {
      const idx = mergedObjections.findIndex(o => o.type.toLowerCase() === objection.type.toLowerCase() && !o.resolved);
      if (idx !== -1) {
        mergedObjections[idx] = {
          ...mergedObjections[idx],
          description: objection.description,
          mentioned_at: objection.mentioned_at || nowStr,
          resolved: objection.resolved,
          resolved_at: objection.resolved ? (objection.resolved_at || nowStr) : mergedObjections[idx].resolved_at
        };
      } else {
        mergedObjections.push(objection);
      }
    }
    const active = mergedObjections.filter(o => !o.resolved);
    const resolved = mergedObjections.filter(o => o.resolved).slice(-3);
    mergedMemory.objections = [...resolved, ...active].slice(-10);

    // 3. Save to database
    const { error } = await (supabaseAdmin as any)
      .from("contacts")
      .update({
        ai_memory: mergedMemory,
        updated_at: nowStr
      })
      .eq("id", contactId)
      .eq("org_id", orgId);

    if (error) {
      console.error("[customer-memory] Error saving contacts.ai_memory:", error);
    }
  } catch (err) {
    console.error("[customer-memory] saveCustomerMemory unexpected error:", err);
  }
}

function mergePurchaseHistory(currentHistory?: any[], newHistory?: any[]): any[] {
  const current = currentHistory || [];
  const newHist = newHistory || [];
  const merged = [...current];
  for (const h of newHist) {
    if (!merged.some(m => m.status === h.status && m.changed_at === h.changed_at)) {
      merged.push(h);
    }
  }
  return merged;
}

/**
 * Run regex heuristics to check if the message contains potential candidate signals (Capa 1)
 */
export function runCapa1Heuristics(userText: string, assistantReply: string): { hasSignals: boolean; signals: CandidateSignal[] } {
  const signals: CandidateSignal[] = [];
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
  let detectedIntent: "exploring" | "interested" | "ready" | "not_interested" | null = null;
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
    detectedIntent = "interested";
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

/**
 * Entry point for analyzing signals post-conversation turn and persisting to the database.
 * Uses only regex heuristics to prevent external LLM dependencies (Capa 2 is bypassed).
 */
export async function extractAndSaveMemory(params: {
  orgId: string;
  contactId: string;
  userText: string;
  assistantReply: string;
  actions: string[];
  currentMemory: CustomerMemory;
  cfg: Record<string, unknown>;
  recentProducts?: any[];
}): Promise<void> {
  const { orgId, contactId, userText, assistantReply, actions, currentMemory, recentProducts } = params;

  if (!contactId) return;

  try {
    // 1. Run regex heuristic filter (Capa 1)
    const { signals } = runCapa1Heuristics(userText, assistantReply);

    // 2. Convert raw signals to Interests, Objections, Preferences, etc.
    const memoryUpdates: CustomerMemory = {
      preferences: {},
      interests: [],
      objections: [],
      purchase_intent: { current: currentMemory.purchase_intent?.current || "exploring", history: [] }
    };

    const nowStr = new Date().toISOString();

    for (const sig of signals) {
      if (sig.confidence < 0.5) continue;

      switch (sig.type) {
        case "preference":
          if (memoryUpdates.preferences) {
            memoryUpdates.preferences[sig.subtype] = sig.value;
          }
          break;

        case "interest":
          if (memoryUpdates.interests) {
            memoryUpdates.interests.push({
              category: sig.subtype,
              keywords: [userText.trim()],
              confidence: sig.confidence,
              first_detected_at: nowStr,
              last_updated_at: nowStr,
              mention_count: 1
            });
          }
          break;

        case "objection":
          if (memoryUpdates.objections) {
            memoryUpdates.objections.push({
              type: sig.subtype,
              description: sig.reason,
              mentioned_at: nowStr,
              resolved: false
            });
          }
          break;

        case "intent":
          if (memoryUpdates.purchase_intent) {
            const newStatus = sig.value as PurchaseIntent["current"];
            memoryUpdates.purchase_intent.current = newStatus;
            memoryUpdates.purchase_intent.history.push({
              status: newStatus,
              changed_at: nowStr,
              reason: sig.reason
            });
          }
          break;

        case "profile":
          if (memoryUpdates.preferences) {
            memoryUpdates.preferences[sig.subtype] = sig.value;
          }
          break;
      }
    }

    // 3. Process products viewed
    if (recentProducts && recentProducts.length > 0) {
      memoryUpdates.products_viewed = recentProducts.map(p => ({
        product_id: p.product_id,
        name: p.name,
        price: p.price,
        category: p.category,
        viewed_at: p.viewed_at || nowStr,
        source: p.source || "sent"
      }));

      // Update purchase_intent if appropriate
      if (memoryUpdates.products_viewed.length > 0 && memoryUpdates.purchase_intent) {
        memoryUpdates.purchase_intent.last_product_id = memoryUpdates.products_viewed[memoryUpdates.products_viewed.length - 1].product_id;
        
        if (memoryUpdates.purchase_intent.current === "exploring") {
          memoryUpdates.purchase_intent.current = "interested";
          memoryUpdates.purchase_intent.history.push({
            status: "interested",
            changed_at: nowStr,
            reason: `Visualizó producto: ${memoryUpdates.products_viewed[memoryUpdates.products_viewed.length - 1].name}`
          });
        }
      }
    }

    // 4. Save to the database (saveCustomerMemory handles the merging)
    await saveCustomerMemory(orgId, contactId, memoryUpdates);

  } catch (err) {
    console.error("[customer-memory] extractAndSaveMemory failed:", err);
  }
}
