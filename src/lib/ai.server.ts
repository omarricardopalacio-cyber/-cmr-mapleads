import { SignJWT, importPKCS8 } from "jose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCatalogConfig, searchCatalog, getCatalogProduct, formatProductForPrompt, type CatalogConfig } from "./catalog.server";

export type Msg = { 
  role: "system" | "user" | "assistant" | "tool"; 
  content: string; 
  tool_calls?: any[]; 
  tool_call_id?: string; 
  name?: string; 
};

/* ============================================================
   1. TOOL SCHEMAS (OpenAI format)
   ============================================================ */
export const CRM_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "assign_tag",
      description: "Asigna una etiqueta al contacto actual. Si no existe, la crea.",
      parameters: {
        type: "object",
        properties: {
          tag_name: { type: "string", description: "Nombre de la etiqueta" },
        },
        required: ["tag_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_reminder",
      description: "Crea un recordatorio para que un agente humano contacte al cliente.",
      parameters: {
        type: "object",
        properties: {
          note: { type: "string", description: "Descripcion del recordatorio" },
          minutes_from_now: { type: "number", description: "Minutos desde ahora para el recordatorio" },
        },
        required: ["note", "minutes_from_now"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "transfer_to_human",
      description: "Transfiere la conversacion a un agente humano (apaga la IA).",
      parameters: { type: "object", properties: {} },
    },
  },
];

/* Catalog tools — solo se incluyen cuando hay integración activa */
export const CATALOG_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_catalog",
      description: "Busca productos en el catálogo de la tienda por palabra clave o nombre. Úsalo cuando el cliente pregunta por un producto, precio, disponibilidad o categoría.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Palabra clave del producto" },
          limit: { type: "number", description: "Cantidad de resultados (1-6)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_product_to_customer",
      description: "Envía al cliente la ficha de un producto del catálogo: imagen + nombre + precio + breve descripción. Úsalo después de search_catalog cuando el cliente te pida ver el producto.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "El valor EXACTO que dice 'ID_PARA_ENVIAR' en los resultados. NUNCA envíes el nombre." },
          caption: {
            type: "string",
            description: "Mensaje breve que acompaña la imagen (opcional)",
          },
        },
        required: ["product_id"],
      },
    },
  },
];

/* ============================================================
   2. LOW-LEVEL PROVIDER CALLS
   ============================================================ */

export async function callLovableAI(opts: {
  model: string;
  messages: Msg[];
  tools?: any[];
}): Promise<{ text: string; toolCalls?: any[] }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY no configurada");
  const body: any = { model: opts.model, messages: opts.messages };
  if (opts.tools?.length) body.tools = opts.tools;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lovable AI ${res.status}: ${text.slice(0, 300)}`);
  }
  const j: any = await res.json();
  const message = j.choices?.[0]?.message;
  return {
    text: message?.content ?? "",
    toolCalls: message?.tool_calls ?? undefined,
  };
}

export async function callOpenAI(opts: {
  apiKey: string;
  model: string;
  messages: Msg[];
  tools?: any[];
}): Promise<{ text: string; toolCalls?: any[] }> {
  const body: any = { model: opts.model, messages: opts.messages };
  if (opts.tools?.length) body.tools = opts.tools;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
  }
  const j: any = await res.json();
  const message = j.choices?.[0]?.message;
  return {
    text: message?.content ?? "",
    toolCalls: message?.tool_calls ?? undefined,
  };
}

export async function callGrok(opts: {
  apiKey: string;
  model: string;
  messages: Msg[];
  tools?: any[];
}): Promise<{ text: string; toolCalls?: any[] }> {
  const body: any = { model: opts.model, messages: opts.messages };
  if (opts.tools?.length) body.tools = opts.tools;
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grok ${res.status}: ${text.slice(0, 300)}`);
  }
  const j: any = await res.json();
  const message = j.choices?.[0]?.message;
  return {
    text: message?.content ?? "",
    toolCalls: message?.tool_calls ?? undefined,
  };
}

/* ----- Vertex helpers ----- */
let cachedToken: { token: string; exp: number } | null = null;

async function getVertexAccessTokenFromJSON(saJson: string): Promise<string> {
  if (cachedToken && cachedToken.exp - 60 > Date.now() / 1000) return cachedToken.token;
  const sa = JSON.parse(saJson);
  const privateKey = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/cloud-platform",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Vertex token ${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  cachedToken = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

function openAIToolsToVertex(tools: any[]) {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

export async function callVertexAI(opts: {
  project: string;
  location: string;
  model: string;
  messages: Msg[];
  tools?: any[];
  vertexServiceAccountJson?: string;
}): Promise<{ text: string; toolCalls?: any[] }> {
  const saJson = opts.vertexServiceAccountJson ?? process.env.VERTEX_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error("VERTEX_SERVICE_ACCOUNT_JSON no configurada");
  const token = await getVertexAccessTokenFromJSON(saJson);
  const url = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.project}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;

  const systemMsg = opts.messages.find((m) => m.role === "system");
  const contents = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body: any = { contents };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  if (opts.tools?.length) {
    body.tools = [{ functionDeclarations: openAIToolsToVertex(opts.tools) }];
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vertex ${res.status}: ${text.slice(0, 400)}`);
  }
  const j: any = await res.json();
  const candidate = j.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join("");

  // Convert Vertex functionCalls to OpenAI tool_calls shape
  const functionCalls = parts.filter((p: any) => p.functionCall);
  const toolCalls = functionCalls.map((p: any, idx: number) => ({
    id: `call_${idx}`,
    type: "function",
    function: {
      name: p.functionCall.name,
      arguments: JSON.stringify(p.functionCall.args ?? {}),
    },
  }));

  return { text, toolCalls: toolCalls.length ? toolCalls : undefined };
}

/* ============================================================
   3. CONFIG FETCHER
   ============================================================ */
export async function getAiConfigFromDb(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("ai_configs")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/* ============================================================
   4. MULTI-PROVIDER ORCHESTRATOR (with tools)
   ============================================================ */
export async function callAiProvider(
  cfg: Record<string, unknown>,
  messages: Msg[],
  tools?: any[]
): Promise<{ text: string; toolCalls?: any[] }> {
  const provider = (cfg.selected_provider as string) || (cfg.provider as string) || "lovable";
  const model = (cfg.model as string) || "gpt-4o";

  if (provider === "openai") {
    const key = cfg.openai_api_key as string;
    if (!key) throw new Error("Falta openai_api_key");
    return callOpenAI({ apiKey: key, model, messages, tools });
  }

  if (provider === "grok") {
    const key = cfg.grok_api_key as string;
    if (!key) throw new Error("Falta grok_api_key");
    return callGrok({ apiKey: key, model, messages, tools });
  }

  if (provider === "vertex") {
    const project = (cfg.vertex_project as string) || "";
    if (!project) throw new Error("Falta vertex_project");
    return callVertexAI({
      project,
      location: (cfg.vertex_location as string) || "us-central1",
      model: (cfg.vertex_model as string) || "gemini-2.5-flash",
      messages,
      tools,
      vertexServiceAccountJson: cfg.vertex_service_account_json as string | undefined,
    });
  }

  // Default: Lovable
  return callLovableAI({ model, messages, tools });
}

/* ============================================================
   5. TOOL EXECUTOR + AUDIT LOG
   ============================================================ */
export type ToolExecCtx = {
  orgId: string;
  threadId: string;
  contactId?: string;
  sessionId?: string;
  chatId?: string;
  catalogCfg?: CatalogConfig | null;
};

export async function executeToolCall(
  toolCall: { id: string; function: { name: string; arguments: string } },
  ctx: ToolExecCtx,
): Promise<{ name: string; result: string }> {
  const { orgId, threadId, contactId, sessionId, chatId, catalogCfg } = ctx;
  const name = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || "{}");

  let result = "";
  let details = "";

  if (name === "assign_tag") {
    const tagName = args.tag_name;
    // 1. Find or create tag
    const { data: existing } = await (supabaseAdmin as any)
      .from("tags")
      .select("id")
      .eq("org_id", orgId)
      .ilike("name", tagName)
      .maybeSingle();
    let tagId = existing?.id;
    if (!tagId) {
      const { data: created } = await (supabaseAdmin as any)
        .from("tags")
        .insert({ org_id: orgId, name: tagName, color: "#3b82f6" })
        .select("id")
        .single();
      tagId = created?.id;
    }
    // 2. Link to contact
    if (tagId && contactId) {
      await (supabaseAdmin as any)
        .from("contact_tags")
        .insert({ contact_id: contactId, tag_id: tagId })
        .maybeSingle(); // ignore duplicates
    }
    result = tagId ? `Etiqueta "${tagName}" asignada.` : `No se pudo asignar etiqueta.`;
    details = `Asigno la etiqueta "${tagName}" al contacto.`;
  } else if (name === "create_reminder") {
    const note = args.note;
    const minutes = args.minutes_from_now || 60;
    const dueAt = new Date(Date.now() + minutes * 60_000).toISOString();
    await (supabaseAdmin as any).from("reminders").insert({
      org_id: orgId,
      contact_id: contactId ?? null,
      note,
      due_at: dueAt,
    });
    result = `Recordatorio creado para dentro de ${minutes} minutos.`;
    details = `Programo un recordatorio: "${note}" para ${dueAt}`;
  } else if (name === "transfer_to_human") {
    try {
      await supabaseAdmin
        .from("threads")
        .update({ ai_enabled: false } as unknown as Record<string, never>)
        .eq("id", threadId)
        .eq("org_id", orgId);
    } catch {
      // ai_enabled puede no existir en prod; ignorar silenciosamente
    }
    result = "Conversacion transferida a agente humano. IA desactivada.";
    details = "Transfirio la conversacion a un agente humano (IA apagada).";
  } else if (name === "search_catalog") {
    if (!catalogCfg) {
      result = "Catálogo no configurado.";
      details = "Intentó buscar en el catálogo pero no hay integración activa.";
    } else {
      try {
        const limit = Math.min(Math.max(Number(args.limit) || 4, 1), 6);
        const query = String(args.query || "");
        let products = await searchCatalog(catalogCfg, query, limit);
        
        if (!products.length) {
          // Búsqueda inteligente 1: Singular/Plural. Quitar 's' o 'es' de las palabras.
          const singularQuery = query.split(" ").map(w => {
            if (w.length > 3) {
              if (w.endsWith("es")) return w.slice(0, -2);
              if (w.endsWith("s")) return w.slice(0, -1);
            }
            return w;
          }).join(" ");

          if (singularQuery !== query && singularQuery.trim().length > 2) {
            products = await searchCatalog(catalogCfg, singularQuery, limit);
            if (products.length > 0) {
              result = `No hay resultados exactos para "${query}", pero SÍ hay para "${singularQuery}". Productos encontrados (usa el id con send_product_to_customer):\n` + products.map((p) => formatProductForPrompt(p)).join("\n") + `\n\nIMPORTANTE: Dile al cliente que no tienes exactamente "${query}", pero ofrécele estas opciones similares y pregúntale si le gusta alguna.`;
            }
          }

          // Búsqueda inteligente 2: Si era una frase larga y aún no hay resultados, intentar con la primera palabra clave
          if (!products.length && query.includes(" ")) {
            const firstWord = singularQuery.split(" ")[0];
            if (firstWord && firstWord.length > 2) {
              products = await searchCatalog(catalogCfg, firstWord, limit);
              if (products.length > 0) {
                result = `No hay resultados exactos para "${query}", pero SÍ hay alternativas para "${firstWord}". Productos encontrados:\n` + products.map((p) => formatProductForPrompt(p)).join("\n") + `\n\nIMPORTANTE: Ofrécele estas opciones similares.`;
              }
            }
          }
        }
        
        if (!result) {
          if (!products.length) {
            result = "Sin resultados en el catálogo para esa búsqueda. (0 productos)";
          } else {
            result = "Productos encontrados (usa el id con send_product_to_customer):\n" + products.map((p) => formatProductForPrompt(p)).join("\n");
          }
        }
        details = `Buscó "${args.query}" en el catálogo (${products.length} resultados).`;
      } catch (e) {
        result = `Error al buscar en catálogo: ${(e as Error).message}. INSTRUCCIÓN OBLIGATORIA PARA LA IA: Dile al cliente literalmente: "Error técnico: " seguido del mensaje exacto de error que acaba de aparecer.`;
        details = result;
      }
    }
  } else if (name === "send_product_to_customer") {
    if (!catalogCfg || !sessionId || !chatId) {
      result = "No puedo enviar productos: falta sesión/chat o catálogo.";
      details = result;
    } else {
      try {
        const prod = await getCatalogProduct(catalogCfg, String(args.product_id));
        if (!prod) {
          result = `Producto ${args.product_id} no encontrado en catálogo.`;
          details = result;
        } else {
          const caption = (args.caption ? String(args.caption) + "\n\n" : "") +
            `*${prod.name}*` +
            (prod.price !== undefined ? `\nPrecio: ${prod.currency ?? "$"} ${prod.price}` : "") +
            (prod.description ? `\n${String(prod.description).slice(0, 300)}` : "") +
            (prod.url ? `\n${prod.url}` : "");
          const media = prod.image_url || prod.images?.[0];
          if (catalogCfg.send_media && media) {
            await (supabaseAdmin as any).from("engine_commands").insert({
              org_id: orgId,
              session_id: sessionId,
              type: "send_media",
              payload: { chatId, media_url: media, caption },
              status: "pending",
            });
          } else {
            await (supabaseAdmin as any).from("engine_commands").insert({
              org_id: orgId,
              session_id: sessionId,
              type: "send_message",
              payload: { chatId, text: caption },
              status: "pending",
            });
          }
          result = `Enviado al cliente: ${prod.name}.`;
          details = `Envió producto ${prod.id} (${prod.name}) al chat ${chatId}.`;
        }
      } catch (e) {
        result = `Error enviando producto: ${(e as Error).message}`;
        details = result;
      }
    }
  } else {
    result = `Herramienta desconocida: ${name}`;
    details = `Intento usar herramienta desconocida: ${name}`;
  }

  // Log to ai_actions_log
  await supabaseAdmin.from("ai_actions_log").insert({
    org_id: orgId,
    thread_id: threadId,
    action_name: name,
    action_details: details,
  });

  return { name, result };
}

/* ============================================================
   6. MAIN AGENT ORCHESTRATOR
   ============================================================ */
export async function runAiAgent({
  orgId,
  threadId,
  contactId,
  sessionId,
  chatId,
  messages,
  cfg,
}: {
  orgId: string;
  threadId: string;
  contactId?: string;
  sessionId?: string;
  chatId?: string;
  messages: Msg[];
  cfg: Record<string, unknown>;
}): Promise<{ reply: string; actions: string[] }> {
  // Cargar integración de catálogo (si está activa)
  const catalogCfg = await getCatalogConfig(orgId);
  const tools = catalogCfg ? [...CRM_TOOLS, ...CATALOG_TOOLS] : CRM_TOOLS;

  const system = [
    (cfg.system_prompt as string)?.trim() || "Eres un asistente comercial útil, cercano y proactivo. Acompañas al cliente hasta que cierre una compra o decida no continuar.",
    (cfg.knowledge_base as string)?.trim()
      ? `\n\n=== BASE DE CONOCIMIENTO / PRODUCTOS ===\n${(cfg.knowledge_base as string).trim()}`
      : "",
    "\n\nHERRAMIENTAS DISPONIBLES: CRM (assign_tag, create_reminder, transfer_to_human) y CATÁLOGO (search_catalog, send_product_to_customer).",
    "\n\nREGLAS DE CATÁLOGO (OBLIGATORIAS):",
    "\n1. Cuando el cliente mencione cualquier producto, precio, stock, talla, color o categoría, llama PRIMERO a search_catalog con el término completo.",
    "\n2. Si search_catalog devuelve count=0, NO te quedes callado. Vuelve a llamar a search_catalog con la palabra CLAVE genérica (ej. 'zapatero de tela' → 'zapatero'; 'mesa de centro de vidrio' → 'mesa'). Hasta 2 reintentos.",
    "\n3. Cuando encuentres productos relevantes (ya sea en la primera búsqueda o en reintentos), USA INMEDIATAMENTE la herramienta send_product_to_customer (hasta un máximo de 3 veces) para enviarle al cliente la foto y los detalles de las mejores opciones. NO le pidas permiso para mostrarle la foto, envíasela de una vez.",
    "\n4. Acompaña el envío de los productos con un mensaje natural invitando al cliente a comprarlos o preguntando qué le parecen.",
    "\n5. Si ambas búsquedas dan 0, di amablemente que no tenemos ese producto y ofrece tomar sus datos para avisarle cuando llegue.",
    "\n6. NUNCA inventes productos, precios ni stock: solo usa los devueltos por search_catalog.",
    "\n7. Cuando el cliente muestre interés real en comprar, pídele nombre, ciudad y horario preferido para agendar y crea un recordatorio con create_reminder.",
    "\n8. Sé breve (2-4 líneas máx por mensaje) y conversacional.",
  ].join("");

  const msgs: Msg[] = [{ role: "system", content: system }, ...messages];

  const ctx: ToolExecCtx = { orgId, threadId, contactId, sessionId, chatId, catalogCfg };
  const actions: string[] = [];
  let lastText = "";

  // Loop de hasta 4 rondas para encadenar tool-calls: search_catalog → send_product → respuesta final
  for (let round = 0; round < 4; round++) {
    const { text, toolCalls } = await callAiProvider(cfg, msgs, tools);
    lastText = text;

    if (!toolCalls?.length) {
      // Sin más tool-calls: respuesta final lista
      return { reply: text || lastText, actions };
    }

    // Anexar mensaje del asistente con tool_calls (obligatorio para APIs tipo OpenAI)
    msgs.push({ role: "assistant", content: text || "", tool_calls: toolCalls });

    // Ejecutar cada tool call y anexar resultados
    for (const tc of toolCalls) {
      const exec = await executeToolCall(tc, ctx);
      actions.push(exec.name);
      msgs.push({ role: "tool", tool_call_id: tc.id, name: exec.name, content: exec.result });
    }
  }

  // Pasada final sin tools para forzar respuesta en texto después de 4 rondas
  const { text: finalText } = await callAiProvider(cfg, msgs);
  return { reply: finalText || lastText, actions };
}

/* ============================================================
   7. BACKWARD-COMPATIBLE generateReply (legacy, no tools)
   ============================================================ */
export async function generateReply(
  cfg: {
    provider: "lovable" | "vertex" | string;
    model: string;
    system_prompt: string;
    knowledge_base: string;
    vertex_project?: string | null;
    vertex_location?: string | null;
    vertex_model?: string | null;
    openai_api_key?: string | null;
    grok_api_key?: string | null;
    vertex_service_account_json?: string | null;
    selected_provider?: string | null;
  },
  userText: string,
  history: Msg[] = []
): Promise<string> {
  const system = [
    cfg.system_prompt?.trim() || "Eres un asistente util.",
    cfg.knowledge_base?.trim()
      ? `\n\n=== BASE DE CONOCIMIENTO / PRODUCTOS ===\n${cfg.knowledge_base.trim()}`
      : "",
  ].join("");
  const messages: Msg[] = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userText },
  ];

  const { text } = await callAiProvider(cfg as Record<string, unknown>, messages);
  return text;
}
