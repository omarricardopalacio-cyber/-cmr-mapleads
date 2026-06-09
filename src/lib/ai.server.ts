import { SignJWT, importPKCS8 } from "jose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCatalogConfig, searchCatalog, getCatalogProduct, type CatalogConfig, type CatalogProduct } from "./catalog.server";
import { resolveProductFromReference } from "./catalog-search";

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
  {
    type: "function" as const,
    function: {
      name: "confirm_order",
      description: "Guarda los datos del pedido en el sistema una vez que el cliente los ha confirmado todos. Pasa los datos recopilados como un objeto JSON stringificado.",
      parameters: {
        type: "object",
        properties: {
          form_data: { type: "string", description: "Objeto JSON (como string) con los datos recopilados (ej. '{\"Nombre\": \"Juan\", \"Ciudad\": \"Bogota\"}')" },
        },
        required: ["form_data"],
      },
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
              "Palabra clave en singular si es posible (ej. 'zapatero' no 'zapateros', 'silla' no 'sillas'). El sistema corrige plurales y typos. Vacío = destacados.",
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
          product_id: { type: "string", description: "id UUID del producto (preferido)" },
          product_reference: {
            type: "string",
            description:
              "Si el cliente dice 'el 6 niveles', 'JDM-128' o parte del nombre, pásalo aquí. El sistema lo vincula al producto de la lista anterior.",
          },
          caption: { type: "string", description: "Texto opcional debajo de la imagen" },
        },
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
          product_id: { type: "string", description: "id UUID del producto (preferido)" },
          product_reference: {
            type: "string",
            description: "Referencia del cliente al producto de la lista (ej. '6 niveles', 'JDM-62')",
          },
          caption: { type: "string", description: "Texto opcional debajo del video" },
        },
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
let cachedToken: { key: string; token: string; exp: number } | null = null;

async function getVertexAccessTokenFromJSON(saJson: string): Promise<string> {
  const sa = JSON.parse(saJson);
  const cacheKey = `${sa.client_email}:${sa.private_key_id ?? ""}`;
  if (cachedToken?.key === cacheKey && cachedToken.exp - 60 > Date.now() / 1000) {
    return cachedToken.token;
  }

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
  cachedToken = { key: cacheKey, token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

function openAIToolsToVertex(tools: any[]) {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

function parseVertexResponse(response: any) {
  const candidate = response?.candidates?.[0] ?? response;
  if (!candidate) return { text: "", toolCalls: undefined };

  let text = "";
  const toolCalls: any[] = [];

  if (typeof candidate.outputText === "string") {
    text += candidate.outputText;
  }

  const elements = Array.isArray(candidate.content)
    ? candidate.content
    : candidate.content
    ? [candidate.content]
    : [];

  for (const element of elements) {
    if (!element) continue;
    if (typeof element.text === "string") {
      text += element.text;
    }
    if (Array.isArray(element.parts)) {
      for (const part of element.parts) {
        if (typeof part?.text === "string") {
          text += part.text;
        }
        if (part?.functionCall) {
          toolCalls.push(part.functionCall);
        }
      }
    }
    if (element?.functionCall) {
      toolCalls.push(element.functionCall);
    }
  }

  const normalizedToolCalls = toolCalls.map((fc: any, idx: number) => ({
    id: `call_${idx}`,
    type: "function",
    function: {
      name: fc.name,
      arguments: JSON.stringify(fc.args ?? {}),
    },
  }));

  return { text: text.trim(), toolCalls: normalizedToolCalls.length ? normalizedToolCalls : undefined };
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
  const content = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      text: m.content,
    }));

  const body: any = { content };
  if (systemMsg) {
    body.systemInstruction = { text: systemMsg.content };
  }
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
  return parseVertexResponse(j);
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
  /** Últimos productos devueltos por search_products (para resolver "el 6 niveles"). */
  lastProducts?: CatalogProduct[];
};

function mapProductsForTool(products: CatalogProduct[]) {
  return products.map((p, index) => ({
    list_index: index + 1,
    id: p.id,
    name: p.name,
    price: p.price,
    stock: p.stock,
    sku: p.sku,
    description: (p.description ?? "").slice(0, 220),
    has_image: !!p.image_url,
    has_video: !!p.video_url,
    badge: p.badge,
  }));
}

async function resolveProductForSend(
  args: Record<string, unknown>,
  ctx: ToolExecCtx,
): Promise<CatalogProduct | null> {
  if (!ctx.catalogCfg) return null;
  const ref = String(args.product_reference || args.product_id || "").trim();
  if (!ref) return null;

  const fromList = resolveProductFromReference(ref, ctx.lastProducts ?? []);
  if (fromList) return fromList;

  if (/^[0-9a-f-]{36}$/i.test(ref)) {
    const byId = await getCatalogProduct(ctx.catalogCfg, ref);
    if (byId) return byId;
  }

  const hits = await searchCatalog(ctx.catalogCfg, ref, 8);
  ctx.lastProducts = hits;
  return resolveProductFromReference(ref, hits) ?? hits[0] ?? null;
}

function mimeFromProductUrl(url: string, kind: "image" | "video"): string {
  const lower = url.split("?")[0].toLowerCase();
  if (kind === "video") {
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".mov")) return "video/quicktime";
    return "video/mp4";
  }
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function queueOutgoingMedia(
  ctx: ToolExecCtx,
  kind: "image" | "video",
  mediaUrl: string,
  caption?: string,
) {
  if (!ctx.sessionId || !ctx.chatId) {
    return "Falta sessionId/chatId; no se puede enviar media.";
  }
  let mimeType = mimeFromProductUrl(mediaUrl, kind);
  let finalUrl = mediaUrl;

  // Si la URL es externa (no de nuestro Storage), descargarla server-side y subirla a Storage.
  // Esto evita errores CORS ("Failed to fetch") al intentar bajarla desde web.whatsapp.com.
  const isOurStorage = mediaUrl.includes("/storage/v1/object/");
  if (!isOurStorage) {
    try {
      const { convertUrlToBase64 } = await import("./media");
      const dl = await convertUrlToBase64(mediaUrl);
      if (dl.mimeType && dl.mimeType !== "application/octet-stream") mimeType = dl.mimeType;
      const ext = mimeType.split("/")[1]?.split(";")[0] || (kind === "video" ? "mp4" : "jpg");
      const path = `${ctx.orgId}/ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const bytes = Buffer.from(dl.base64, "base64");
      const { error: upErr } = await supabaseAdmin.storage
        .from("media")
        .upload(path, bytes, { contentType: mimeType, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabaseAdmin.storage.from("media").getPublicUrl(path);
      finalUrl = pub.publicUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ai.queueOutgoingMedia] No se pudo proxyfear ${kind}:`, msg);
      return `No se pudo enviar el ${kind}: ${msg}`;
    }
  }

  const payload: Record<string, unknown> = {
    chatId: ctx.chatId,
    mediaUrl: finalUrl,
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
    media: { url: finalUrl, mimeType, mime_type: mimeType },
    wa_message_id: `pending-${cmdId}`,
    sent_at: new Date().toISOString(),
  });
  const { error } = await (supabaseAdmin as any).from("engine_commands").insert({
    id: cmdId,
    org_id: ctx.orgId,
    session_id: ctx.sessionId,
    type: "SEND_MEDIA",
    payload,
    status: "pending",
  });
  if (error) return `Error encolando ${kind}: ${error.message}`;
  return `${kind === "video" ? "Video" : "Imagen"} enviado al cliente.`;
}

export async function executeToolCall(
  toolCall: { id: string; function: { name: string; arguments: string | Record<string, unknown> } },
  ctx: ToolExecCtx,
): Promise<{ name: string; result: string }> {
  const { orgId, threadId, contactId, sessionId, chatId, catalogCfg } = ctx;
  const name = toolCall.function.name;

  let args: Record<string, unknown> = {};
  const rawArgs = toolCall.function.arguments;
  if (typeof rawArgs === "string") {
    try {
      args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
    } catch (error) {
      args = {};
    }
  } else if (typeof rawArgs === "object" && rawArgs !== null) {
    args = rawArgs;
  }

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
    const minutes = Number(args.minutes_from_now) || 60;
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
  } else if (name === "confirm_order") {
    const rawFormData = args.form_data;
    let formData: Record<string, unknown> | null = null;

    if (typeof rawFormData === "string") {
      try {
        formData = rawFormData.trim() ? JSON.parse(rawFormData) : {};
      } catch (error: any) {
        result = `Datos del pedido inválidos: ${error?.message || "form_data debe ser JSON"}`;
        details = `Error parseando form_data: ${error?.message || "invalid JSON"}`;
      }
    } else if (typeof rawFormData === "object" && rawFormData !== null) {
      formData = rawFormData as Record<string, unknown>;
    } else {
      formData = {};
    }

    if (result) {
      // Parsing failed, no insert attempt.
    } else {
      const { data: inserted, error: insertError } = await (supabaseAdmin as any)
        .from("orders")
        .insert({
          org_id: orgId,
          contact_id: contactId ?? null,
          thread_id: threadId,
          status: "confirmed",
          form_data: formData,
        })
        .select("id")
        .single();

      if (insertError) {
        result = `Error guardando el pedido: ${insertError.message}`;
        details = `orders insert failed: ${insertError.message}`;
      } else {
        await (supabaseAdmin as any)
          .from("threads")
          .update({ purchase_intent: "compro" })
          .eq("id", threadId);
        result = "Pedido guardado exitosamente. Agradece al cliente y confirma que su pedido está en proceso.";
        details = `Pedido guardado con datos: ${JSON.stringify(formData)}`;
      }
    }
  } else if (name === "search_products") {
    if (!catalogCfg) {
      result = "Catálogo no configurado.";
      details = "Intentó buscar en el catálogo pero no hay integración activa.";
    } else {
      try {
        const q = (args.query || "").toString().trim();
        const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 5);
        const products = await searchCatalog(catalogCfg, q, limit);
        ctx.lastProducts = products;

        if (!products.length) {
          const fallback = await searchCatalog(catalogCfg, "", limit);
          ctx.lastProducts = fallback;
          result = JSON.stringify({
            found: 0,
            message: "No hay coincidencias exactas. Estos son alternativos:",
            products: mapProductsForTool(fallback),
          });
        } else {
          result = JSON.stringify({
            found: products.length,
            products: mapProductsForTool(products),
            hint: "Si el cliente elige por descripción (ej. 'el de 6 niveles'), usa product_reference con esa frase en send_product_image.",
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
        const p = await resolveProductForSend(args, ctx);
        if (!p) {
          result =
            "Producto no encontrado. Usa product_id de la última búsqueda o product_reference (ej. '6 niveles', 'JDM-128').";
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
            details = `${name}: ${p.id} (${p.name}) a ${chatId}`;
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
3. Pregunta cuál le interesa. Guarda mentalmente el id de cada producto del JSON.
4. Si el cliente dice "el de 6 niveles", "el JDM-128" o similar, NO busques de nuevo: usa send_product_image con product_reference exactamente con lo que dijo el cliente (el sistema lo vincula al producto correcto de la lista).
5. Cuando pida "foto"/"imagen"/"ver", llama send_product_image (product_id o product_reference). Luego ofrece el video.
6. Si pide video, llama send_product_video. Si has_video=false, dilo y ofrece la imagen.
7. Búsquedas: usa singular (zapatero, silla). El sistema corrige plurales (zapateros→zapatero) y typos (siyas→silla).
8. Nunca digas que no puedes enviar imágenes si has_image=true en el JSON.
`.trim();

  // Load order fields
  const { data: orderFieldsData } = await supabaseAdmin
    .from("order_fields")
    .select("name, is_required")
    .eq("org_id", orgId)
    .order("display_order", { ascending: true });
    
  const orderFields = orderFieldsData ?? [];
  const orderFieldsText = orderFields.length 
    ? `\n\n=== RECOPILACIÓN DE PEDIDOS (OBLIGATORIO) ===\n1. Detecta intención de compra y pregunta si desea agendar o hacer pedido.\n2. Si el cliente dice SÍ, confirma o indica que quiere continuar, envía EXACTAMENTE este mensaje para pedir sus datos:\n"Para agendar su pedido por favor indíqueme:\n${orderFields.map((f: any) => `* ${f.name}${f.is_required ? '' : ' (opcional)'}`).join('\n')}"\n3. Si falta algún dato requerido, insiste amablemente pero no sigas sin él. Repite las preguntas solo cuando sean necesarias.\n4. Cuando tengas todos los datos, muestra un resumen claro y pregunta: "¿La información es correcta para confirmar su pedido?"\n5. SOLO cuando el cliente confirme explícitamente, ejecuta la herramienta confirm_order con form_data como JSON. NO digas "pedido registrado" ni confirmes el pedido si no ejecutas confirm_order.\n6. El único mecanismo válido para guardar el pedido en el sistema es llamar a la herramienta confirm_order. Si no la ejecutas, no puede considerarse pedido confirmado.\n7. Después de ejecutar confirm_order, responde algo como: "Pedido registrado correctamente. Gracias, su pedido está en proceso."`
    : "";

  // Load knowledge sources
  const { data: knowledgeSourcesData } = await supabaseAdmin
    .from("knowledge_sources")
    .select("name, source_type, content")
    .eq("org_id", orgId)
    .eq("is_active", true);

  const knowledgeSourcesText = knowledgeSourcesData?.length
    ? `\n\n=== FUENTES DE CONOCIMIENTO ADICIONALES ===\n${knowledgeSourcesData
        .map((ks: any) => `[Tipo: ${ks.source_type} | Nombre: ${ks.name}]\n${ks.content}`)
        .join('\n\n')}`
    : "";

  // Dynamic context variables
  const now = new Date();
  const timeZone = "America/Bogota";
  const diaActual = new Intl.DateTimeFormat("es-CO", { timeZone, weekday: "long" }).format(now);
  const fechaActual = now.toLocaleString("en-CA", { timeZone, hour12: false }).slice(0, 10);
  const fechaLegible = new Intl.DateTimeFormat("es-CO", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const horaActual = new Intl.DateTimeFormat("es-CO", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  const dynamicContextText = `\n\n=== CONTEXTO ACTUAL ===\nfecha_actual: ${fechaActual}\ndia_actual: ${diaActual}\nfecha_legible: ${fechaLegible}\nhora_actual: ${horaActual}`;

  const conversationRulesText = `\n\n=== REGLAS DE CONVERSACIÓN (OBLIGATORIO) ===
- Haz MÁXIMO UNA (1) pregunta por mensaje. NUNCA hagas dos preguntas en el mismo mensaje.
- Sé breve y directo. Respuestas cortas. No más de 3 líneas salvo que el cliente pida detalle.
- NUNCA te presentes ni digas tu nombre si ya hay mensajes previos en la conversación.
- NUNCA repitas preguntas que ya hiciste antes en el historial.
- Si el cliente ya mostró interés en algo, continúa desde ahí sin empezar de cero.
- Si el cliente confirma la información del pedido, llama obligatoriamente la herramienta \`confirm_order\` y no digas "pedido registrado" hasta que esa herramienta se ejecute.`;

  const system = [
    (cfg.system_prompt as string)?.trim() || "Eres un asistente comercial útil, cercano y proactivo. Acompañas al cliente hasta que cierre una compra o decida no continuar.",
    conversationRulesText,
    (cfg.knowledge_base as string)?.trim()
      ? `\n\n=== BASE DE CONOCIMIENTO / PRODUCTOS ===\n${(cfg.knowledge_base as string).trim()}`
      : "",
    "\n\nTienes acceso a herramientas para ayudar al cliente. Usalas cuando sea necesario.",
    "\n\n" + PRODUCT_FLOW_GUIDE,
    orderFieldsText,
    knowledgeSourcesText,
    dynamicContextText,
  ].join("");

  const msgs: Msg[] = [{ role: "system", content: system }, ...messages];

  const ctx: ToolExecCtx = { orgId, threadId, contactId, sessionId, chatId, catalogCfg };
  const actions: string[] = [];
  let orderConfirmed = false;
  let lastText = "";

  const isOrderClaimWithoutConfirmation = (replyText: string) => {
    const lower = String(replyText).toLowerCase();
    const patterns: RegExp[] = [
      /pedido[\s\S]{0,60}(registrad[oa]|guardad[oa]|confirmad[oa]|en proceso|procesad[oa])/i,
      /(registrad[oa]|guardad[oa]|confirmad[oa])[\s\S]{0,40}(su |tu |el )?pedido/i,
      /gracias por su compra/i,
      /muchas gracias por su compra/i,
      /pedido ha sido (registrad|guardad|confirmad)/i,
    ];
    return patterns.some((re) => re.test(lower));
  };

  const buildSafeReply = (replyText: string) => {
    if (isOrderClaimWithoutConfirmation(replyText) && !orderConfirmed) {
      return {
        reply: "Permíteme un momento para registrar tu pedido en el sistema...",
        actions,
      };
    }
    return { reply: replyText, actions };
  };

  const buildRecoveredOrderData = (replyText: string) => {
    const visibleHistory = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
      .filter((m) => !m.content.trim().startsWith("[INSTRUCCIÓN DEL SISTEMA"));
    const recent = visibleHistory.slice(-16);
    const lastUser = [...visibleHistory].reverse().find((m) => m.role === "user")?.content?.trim() ?? "";
    const lastAssistant = [...visibleHistory].reverse().find((m) => m.role === "assistant")?.content?.trim() ?? "";

    return {
      Origen: "Recuperación automática: la IA confirmó el pedido sin ejecutar la herramienta confirm_order",
      "Confirmación cliente": lastUser,
      "Resumen mostrado al cliente": lastAssistant,
      "Respuesta de confirmación enviada": replyText,
      "Historial reciente": recent
        .map((m) => `${m.role === "assistant" ? "Asistente" : "Cliente"}: ${m.content.trim()}`)
        .join("\n"),
      "Registrado en": new Date().toISOString(),
    } as Record<string, unknown>;
  };

  const recoverMissingOrderConfirmation = async (replyText: string) => {
    if (!isOrderClaimWithoutConfirmation(replyText) || actions.includes("confirm_order") || orderConfirmed) {
      return false;
    }

    const exec = await executeToolCall(
      {
        id: `auto_confirm_${Date.now()}`,
        function: {
          name: "confirm_order",
          arguments: JSON.stringify({
            form_data: JSON.stringify(buildRecoveredOrderData(replyText)),
          }),
        },
      },
      ctx
    );

    actions.push(exec.name);
    orderConfirmed = exec.result.toLowerCase().includes("pedido guardado exitosamente");
    return orderConfirmed;
  };

  // Loop de hasta 4 rondas para encadenar tool-calls: search_catalog → send_product → respuesta final
  for (let round = 0; round < 4; round++) {
    const { text, toolCalls } = await callAiProvider(cfg, msgs, tools);
    lastText = text;

    if (!toolCalls?.length) {
      const finalText = text || lastText;
      if (
        isOrderClaimWithoutConfirmation(finalText) &&
        !actions.includes("confirm_order") &&
        !orderConfirmed &&
        round < 3
      ) {
        msgs.push({
          role: "system",
          content:
            "El asistente afirmó que el pedido está registrado, pero no ejecutó confirm_order. Intenta nuevamente y obliga el uso de confirm_order con el JSON de form_data.",
        });
        continue;
      }

      if (await recoverMissingOrderConfirmation(finalText)) {
        return { reply: finalText, actions };
      }

      // Sin más tool-calls: respuesta final lista
      return buildSafeReply(finalText);
    }

    // Anexar mensaje del asistente con tool_calls (obligatorio para APIs tipo OpenAI)
    msgs.push({ role: "assistant", content: text || "", tool_calls: toolCalls });

    // Ejecutar cada tool call y anexar resultados
    for (const tc of toolCalls) {
      const exec = await executeToolCall(tc, ctx);
      actions.push(exec.name);
      if (exec.name === "confirm_order" && exec.result.toLowerCase().includes("pedido guardado exitosamente")) {
        orderConfirmed = true;
      }
      msgs.push({ role: "tool", tool_call_id: tc.id, name: exec.name, content: exec.result });
    }
  }

  // Pasada final sin tools para forzar respuesta en texto después de 4 rondas
  const { text: finalText } = await callAiProvider(cfg, msgs);
  if (await recoverMissingOrderConfirmation(finalText || lastText)) {
    return { reply: finalText || lastText, actions };
  }
  return buildSafeReply(finalText || lastText);
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
