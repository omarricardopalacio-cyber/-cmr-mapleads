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
      name: "search_products",
      description:
        "Busca productos en el catálogo de la tienda. Devuelve productos con id, nombre, descripción, precio, stock e indica si tienen imagen/video disponible. Llama SIEMPRE esta herramienta antes de hablar de productos, precios o características.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Texto a buscar (p.ej. 'zapatero', 'organizador'). Vacío = devolver destacados.",
          },
          limit: { type: "number", description: "Máx productos (1-5). Default 5." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_product_image",
      description:
        "Envía la imagen del producto al cliente por WhatsApp con un caption corto. Úsala apenas el cliente muestre interés en un producto concreto. Usa product_id devuelto por search_products.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "id del producto devuelto por search_products" },
          caption: { type: "string", description: "Texto opcional debajo de la imagen" },
        },
        required: ["product_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_product_video",
      description:
        "Envía el video del producto al cliente por WhatsApp. Úsala cuando el cliente pida ver el video o más detalle visual. Devuelve error si el producto no tiene video.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "id del producto devuelto por search_products" },
          caption: { type: "string", description: "Texto opcional debajo del video" },
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

async function queueOutgoingMedia(
  ctx: ToolExecCtx,
  kind: "image" | "video",
  mediaUrl: string,
  caption?: string,
) {
  if (!ctx.sessionId || !ctx.chatId) {
    return "Falta sessionId/chatId; no se puede enviar media.";
  }
  const mimeType = kind === "video" ? "video/mp4" : "image/jpeg";
  const payload: Record<string, unknown> = {
    chatId: ctx.chatId,
    mediaUrl,
    mimeType,
    caption: caption || "",
    text: caption || "",
  };
  const cmdId = (globalThis.crypto?.randomUUID?.() ?? `cmd_${Date.now()}_${Math.random()}`) as string;
  // Echo en la conversación para que el operador lo vea en el CRM
  await (supabaseAdmin as any).from("messages").insert({
    org_id: ctx.orgId,
    thread_id: ctx.threadId,
    direction: "out",
    text: caption || "",
    media: { url: mediaUrl, mimeType, mime_type: mimeType },
    wa_message_id: `pending-${cmdId}`,
    sent_at: new Date().toISOString(),
  });
  const { error } = await (supabaseAdmin as any).from("engine_commands").insert({
    id: cmdId,
    org_id: ctx.orgId,
    session_id: ctx.sessionId,
    type: "SEND_MESSAGE",
    payload,
    status: "pending",
  });
  if (error) return `Error encolando ${kind}: ${error.message}`;
  return `${kind === "video" ? "Video" : "Imagen"} enviado al cliente.`;
}

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
  } else if (name === "search_products") {
    if (!catalogCfg) {
      result = "Catálogo no configurado.";
      details = "Intentó buscar en el catálogo pero no hay integración activa.";
    } else {
      try {
        const q = (args.query || "").toString().trim();
        const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 5);
        const products = await searchCatalog(catalogCfg, q, limit);
        
        if (!products.length) {
          // Fallback: traer destacados sin filtro
          const fallback = await searchCatalog(catalogCfg, "", limit);
          result = JSON.stringify({
            found: 0,
            message: "No hay coincidencias exactas. Estos son alternativos:",
            products: fallback.map((p: any) => ({
              id: p.id, name: p.name, price: p.price, stock: p.stock,
              description: (p.description ?? "").slice(0, 220),
              has_image: !!p.image_url, has_video: !!p.video_url, badge: p.badge,
            })),
          });
        } else {
          result = JSON.stringify({
            found: products.length,
            products: products.map((p: any) => ({
              id: p.id, name: p.name, price: p.price, stock: p.stock,
              description: (p.description ?? "").slice(0, 220),
              has_image: !!p.image_url, has_video: !!p.video_url, badge: p.badge,
            })),
          });
        }
        details = `Buscó productos: "${q}" (${products.length} resultados)`;
      } catch (e) {
        result = `Error al buscar en catálogo: ${(e as Error).message}`;
        details = result;
      }
    }
  } else if (name === "send_product_image" || name === "send_product_video") {
    if (!catalogCfg || !sessionId || !chatId) {
      result = "No puedo enviar productos: falta sesión/chat o catálogo.";
      details = result;
    } else {
      try {
        const productId = args.product_id;
        const p = await getCatalogProduct(catalogCfg, String(productId));
        if (!p) {
          result = "Producto no encontrado.";
          details = result;
        } else {
          const kind = name === "send_product_video" ? "video" : "image";
          const url = kind === "video" ? p.video_url : p.image_url;
          if (!url) {
            result = `El producto "${p.name}" no tiene ${kind === "video" ? "video" : "imagen"} disponible.`;
            details = result;
          } else {
            const caption = (args.caption as string) || `${p.name} — $${p.price || ""}`;
            result = await queueOutgoingMedia(ctx, kind, url, caption);
            details = `${name}: ${productId} a ${chatId}`;
          }
        }
      } catch (e) {
        result = `Error enviando media: ${(e as Error).message}`;
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

  const PRODUCT_FLOW_GUIDE = `
Eres un asistente comercial por WhatsApp. Reglas obligatorias cuando el cliente menciona producto, precio, características, stock, foto o video:
1. SIEMPRE llama primero la herramienta "search_products" con la palabra clave del cliente. Nunca inventes precios ni características.
2. Si search_products devuelve productos, responde mostrando 3 a 5 productos así (uno por línea):
   • *NOMBRE* — $PRECIO  (badge si hay)
     Características clave en una frase.
3. Pregunta cuál le interesa.
4. Cuando el cliente elija uno o pida "foto"/"imagen"/"ver", llama "send_product_image" con el product_id correcto y luego pregunta si desea ver el video.
5. Si pide video, llama "send_product_video". Si has_video=false, dilo claramente y ofrece más imágenes o alternativos.
6. Si search_products devuelve found=0, sugiere los alternativos que devuelva el JSON y pregunta si alguno le sirve.
7. Nunca digas "no puedo enviar imágenes": SIEMPRE usa send_product_image cuando el cliente quiera verla.
`.trim();

  const system = [
    (cfg.system_prompt as string)?.trim() || "Eres un asistente comercial útil, cercano y proactivo. Acompañas al cliente hasta que cierre una compra o decida no continuar.",
    (cfg.knowledge_base as string)?.trim()
      ? `\n\n=== BASE DE CONOCIMIENTO / PRODUCTOS ===\n${(cfg.knowledge_base as string).trim()}`
      : "",
    "\n\nTienes acceso a herramientas para ayudar al cliente. Usalas cuando sea necesario.",
    "\n\n" + PRODUCT_FLOW_GUIDE,
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
