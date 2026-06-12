import { SignJWT, importPKCS8 } from "jose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCatalogConfig, searchCatalog, getCatalogProduct, type CatalogConfig, type CatalogProduct } from "./catalog.server";
import { resolveProductFromReference } from "./catalog-search";
import { selectRelevantKnowledgeSources } from "./intent-classifier";

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
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq ${res.status}: ${text.slice(0, 300)}`);
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
  let sa: any;
  try {
    sa = JSON.parse(saJson);
  } catch (err) {
    throw new Error(`Vertex service account JSON inválido: ${err}`);
  }
  
  // Validar campos requeridos
  if (!sa.client_email) throw new Error("Vertex SA: falta client_email");
  if (!sa.private_key) throw new Error("Vertex SA: falta private_key");
  
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
  if (!j.access_token) throw new Error("Vertex token: no access_token en respuesta OAuth");
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
  onRetry?: (attempt: number) => Promise<void>;
  maxAttempts?: number;
}): Promise<{ text: string; toolCalls?: any[]; retryAttempt?: number }> {
  const saJson = opts.vertexServiceAccountJson ?? process.env.VERTEX_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error("VERTEX_SERVICE_ACCOUNT_JSON no configurada");
  const token = await getVertexAccessTokenFromJSON(saJson);
  const url = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.project}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;

  const systemMsg = opts.messages.find((m) => m.role === "system");
  const contents = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        return {
          role: "user",
          parts: [{ functionResponse: { name: m.name || "tool", response: { result: m.content } } }],
        };
      }

      if (m.role === "assistant" && m.tool_calls?.length) {
        const functionParts = m.tool_calls.map((tc: any) => {
          let args: Record<string, unknown> = {};
          try {
            args = typeof tc.function?.arguments === "string"
              ? JSON.parse(tc.function.arguments || "{}")
              : tc.function?.arguments ?? {};
          } catch {
            args = {};
          }
          return { functionCall: { name: tc.function?.name, args } };
        });
        return {
          role: "model",
          parts: [m.content ? { text: m.content } : null, ...functionParts].filter(Boolean),
        };
      }

      return {
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      };
    });

  const body: any = { contents };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }
  if (opts.tools?.length) {
    body.tools = [{ functionDeclarations: openAIToolsToVertex(opts.tools) }];
  }

  const bodyText = JSON.stringify(body);
  const requestSizeBytes =
    typeof Buffer !== 'undefined'
      ? Buffer.byteLength(bodyText, 'utf8')
      : new TextEncoder().encode(bodyText).length;
  console.info('[callVertexAI] vertex request size', {
    model: opts.model,
    project: opts.project,
    location: opts.location,
    messagesCount: opts.messages.length,
    toolCount: opts.tools?.length ?? 0,
    requestSizeBytes,
  });

  const maxAttempts = opts.maxAttempts ?? 3;
  let lastError: Error | null = null;
  const retriedAttempts = new Set<number>();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Vertex ${res.status}: ${text.slice(0, 400)}`);
        if ((res.status === 429 || res.status === 503) && attempt < maxAttempts) {
          retriedAttempts.add(attempt);
          if (opts.onRetry) {
            try {
              await opts.onRetry(attempt);
            } catch (err) {
              console.warn('[callVertexAI] onRetry callback failed', err);
            }
          }
          console.warn('[callVertexAI] retrying due to Vertex transient error', {
            attempt,
            status: res.status,
            model: opts.model,
            project: opts.project,
            location: opts.location,
          });
          lastError = err;
          const backoffMs = 1000 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        throw err;
      }

      const j: any = await res.json();
      const result = parseVertexResponse(j);
      return {
        ...result,
        retryAttempt: retriedAttempts.size > 0 ? attempt : undefined,
      };
    } catch (err) {
      if (attempt < maxAttempts) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('429') || errMsg.includes('503') || errMsg.includes('AbortError') || errMsg.includes('timeout')) {
          retriedAttempts.add(attempt);
          if (opts.onRetry) {
            try {
              await opts.onRetry(attempt);
            } catch (err) {
              console.warn('[callVertexAI] onRetry callback failed', err);
            }
          }
          console.warn('[callVertexAI] transient failure, retrying', {
            attempt,
            error: errMsg,
            model: opts.model,
            project: opts.project,
            location: opts.location,
          });
          lastError = err instanceof Error ? err : new Error(errMsg);
          const backoffMs = 1000 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error('Vertex request failed after all retry attempts');
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
const hasOpenAICredentials = (cfg: Record<string, unknown>) => !!(cfg.openai_api_key as string);
const hasGrokCredentials = (cfg: Record<string, unknown>) => !!(cfg.grok_api_key as string);
const hasLovableCredentials = () => !!process.env.LOVABLE_API_KEY;
const normalizeOpenAIModel = (model?: string) => model?.startsWith("gpt-") ? model : "gpt-4o-mini";
const normalizeGrokModel = (model?: string) => /^(llama|gemma|mixtral|compound)/i.test(model ?? "") ? model! : "llama-3.1-8b-instant";
const normalizeLovableModel = (model?: string) => model?.includes("/") ? model : "google/gemini-3-flash-preview";

const validateCredentials = (provider: string, cfg: Record<string, unknown>) => {
  if (provider === "openai" && !cfg.openai_api_key) throw new Error("Falta openai_api_key");
  if (provider === "grok" && !cfg.grok_api_key) throw new Error("Falta grok_api_key");
  if (provider === "vertex" && !cfg.vertex_project) throw new Error("Falta vertex_project");
};

const callProviderByName = async (
  provider: string,
  cfg: Record<string, unknown>,
  messages: Msg[],
  tools?: any[],
  onRetry?: (attempt: number) => Promise<void>
): Promise<{ text: string; toolCalls?: any[]; retryAttempt?: number }> => {
  const model = (cfg.model as string) || "gpt-4o";
  if (provider === "openai") {
    return callOpenAI({ apiKey: cfg.openai_api_key as string, model: normalizeOpenAIModel(model), messages, tools });
  }
  if (provider === "grok") {
    return callGrok({ apiKey: cfg.grok_api_key as string, model: normalizeGrokModel(model), messages, tools });
  }
  if (provider === "vertex") {
    return callVertexAI({
      project: (cfg.vertex_project as string) || "",
      location: (cfg.vertex_location as string) || "us-central1",
      model: (cfg.vertex_model as string) || "gemini-2.5-flash",
      messages,
      tools,
      vertexServiceAccountJson: cfg.vertex_service_account_json as string | undefined,
      onRetry,
      maxAttempts: 1,
    });
  }
  return callLovableAI({ model: normalizeLovableModel(model), messages, tools });
};

const fallbackVertexProvider = async (
  cfg: Record<string, unknown>,
  messages: Msg[],
  tools?: any[],
) => {
  const fallback = (cfg.fallback_provider as string) || "lovable";
  if (fallback === "none" || fallback === "vertex") {
    return callLovableAI({ model: normalizeLovableModel(cfg.model as string), messages, tools });
  }
  try {
    validateCredentials(fallback, cfg);
    return await callProviderByName(fallback, cfg, messages, tools);
  } catch (err) {
    console.warn(`[fallbackVertexProvider] Fallback provider ${fallback} failed or lacks credentials:`, err);
    return callLovableAI({ model: normalizeLovableModel(cfg.model as string), messages, tools });
  }
};

export async function callAiProvider(
  cfg: Record<string, unknown>,
  messages: Msg[],
  tools?: any[],
  onRetry?: (attempt: number) => Promise<void>
): Promise<{ text: string; toolCalls?: any[]; retryAttempt?: number }> {
  const provider = (cfg.selected_provider as string) || (cfg.provider as string) || "lovable";
  const fallback = (cfg.fallback_provider as string) || "lovable";

  try {
    validateCredentials(provider, cfg);
    return await callProviderByName(provider, cfg, messages, tools, onRetry);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[callAiProvider] Primary provider ${provider} failed, trying fallback ${fallback}. Error:`, errMsg);

    if (fallback && fallback !== "none" && fallback !== provider) {
      try {
        validateCredentials(fallback, cfg);
        return await callProviderByName(fallback, cfg, messages, tools, onRetry);
      } catch (fallbackErr) {
        console.warn(`[callAiProvider] Fallback provider ${fallback} also failed, falling back to lovable. Error:`, fallbackErr);
      }
    }

    return callLovableAI({ model: normalizeLovableModel(cfg.model as string), messages, tools });
  }
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
  /** Consulta actual de catálogo que debe persistirse entre turnos. */
  catalogSearchQuery?: string | null;
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
    attributes: p.attributes ? Object.fromEntries(Object.entries(p.attributes).slice(0, 8)) : undefined,
    has_image: !!p.image_url,
    badge: p.badge,
  }));
}

function formatProductDetailsForCustomer(p: CatalogProduct): string {
  const lines = [`${p.name}${p.sku ? ` (${p.sku})` : ""}`];
  if (p.price != null && String(p.price).trim() !== "") lines.push(`Valor: $${p.price}`);
  if (p.description?.trim()) {
    const desc = p.description.trim();
    // Evitar textos kilométricos en WhatsApp: recortar a ~320 caracteres en límite de palabra.
    const trimmed = desc.length > 320 ? desc.slice(0, 320).replace(/\s+\S*$/, " ") + " … " : desc;
    lines.push(`Detalle: ${trimmed}`);
  }
  if (p.attributes && Object.keys(p.attributes).length) {
    for (const [key, value] of Object.entries(p.attributes).slice(0, 6)) {
      if (value == null || String(value).trim() === "") continue;
      lines.push(`${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
    }
  }
  if (p.stock != null) lines.push(`Disponibilidad: ${p.stock > 0 ? "disponible" : "por confirmar"}`);
  if (p.video_url) lines.push("Tengo video disponible si quieres verlo mejor 😊");
  return lines.join("\n");
}

function isProductDetailQuestion(text: string): boolean {
  const t = (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(detalle|detalles|informacion|info|caracteristica|caracteristicas|especificacion|especificaciones|material|hech[oa]|sirve|funciona|garantia|garantía|medida|medidas|tamano|tamaño|peso|voltaje|temperatura|color|tipo de cabello|cabello)\b/.test(t);
}

function buildProductDetailReply(product: CatalogProduct): string {
  const hasDetails = Boolean(product.description?.trim() || (product.attributes && Object.keys(product.attributes).length));
  const price = product.price != null && String(product.price).trim() !== "" ? ` Su valor es $${product.price}.` : "";
  if (!hasDetails) {
    return `Del ${product.name}${price} no tengo más especificaciones cargadas en el catálogo. Dame un minuto ya te verifico 😊`;
  }
  return `${formatProductDetailsForCustomer(product)}\n\n¿Te sirve para avanzar con el pedido? 😊`;
}

function selectRelevantText(raw: string, query: string, maxChars: number): string {
  const text = (raw || "").trim();
  if (!text || text.length <= maxChars) return text;
  const terms = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  const blocks = text
    .split(/\n{2,}|(?=Producto:|Referencia:|SKU:|Pregunta:|FAQ:)/i)
    .map((b) => b.trim())
    .filter(Boolean);
  const scored = blocks
    .map((block, idx) => {
      const normalized = block.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const score = terms.reduce((acc, term) => acc + (normalized.includes(term) ? 1 : 0), 0);
      return { block, index: idx, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = scored.length ? scored : blocks.slice(0, 3).map((block, idx) => ({ block, idx, score: 0 }));
  let out = "";
  for (const item of selected) {
    if (out.length >= maxChars) break;
    out += (out ? "\n\n" : "") + item.block.slice(0, Math.min(item.block.length, maxChars - out.length));
  }
  return out.slice(0, maxChars);
}

/**
 * Detecta cuando el mensaje (o referencia) es una SELECCIÓN PURA por número o
 * posición: "3", "la 3", "el 2", "quiero el 4", "opción 5", "el segundo".
 * Devuelve el número (1..12) o null. Es estricto a propósito para NO confundir
 * como descripciones "el de 6 niveles".
 */
export function parseSelectionNumber(text: string): number | null {
  let t = (text || "").toLowerCase().trim();
  if (!t) return null;
  // Quitar puntuación/emojis finales comunes.
  t = t
    .replace(/[.!¡¿?\s]+$/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+$/gu, "")
    .trim();
  const numPat = /^(?:(?:quiero|dame|me\s+gusta|me\s+interesa|me\s+quedo\s+con|prefiero|env[ií]ame|mu[eé]strame|ll[eé]vame)\s+)?(?:el|la|los|las|opci[oó]n|n[uú]mero|numero|nro|#)?\s*(\d{1,2})$/;
  const m = t.match(numPat);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 12) return n;
  }
  const ordinals: Record<string, number> = {
    primero: 1,
    primera: 1,
    segundo: 2,
    segunda: 2,
    tercero: 3,
    tercera: 3,
    cuarto: 4,
    cuarta: 4,
    quinto: 5,
    quinta: 5,
    sexto: 6,
    sexta: 6,
  };
  const stripped = t
    .replace(/^(?:quiero|dame|me\s+gusta|prefiero)\s+(?:el|la)\s+/, "")
    .replace(/^(el|la)\s+/, "");
  if (ordinals[stripped] != null) return ordinals[stripped];
  return null;
}

/**
 * Reconstruye, en orden, los productos mostrados recientemente al cliente a
 * partir de los comandos SEND_MEDIA conectados (cada uno guarda dedupe_key
 * "image:<id>" y un caption que empieza con el número de la lista). Permite
 * resolver "la 3" entre turnos sin volver a llamar a la IA.
 */
async function loadRecentlyShownProducts(ctx: ToolExecCtx): Promise<CatalogProduct[]> {
  if (!ctx.catalogCfg || !ctx.sessionId || !ctx.chatId) return [];
  try {
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data } = await (supabaseAdmin as any)
      .from("engine_commands")
      .select("payload, created_at")
      .eq("org_id", ctx.orgId)
      .eq("session_id", ctx.sessionId)
      .eq("type", "SEND_MEDIA")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(40);

    if (!data?.length) return [];
    // De más reciente a más antiguo: la primera posición vista pertenece a la última ronda de imágenes.
    const byPosition = new Map<number, string>();
    for (const cmd of data) {
      const p = cmd?.payload ?? {};
      if (p.chatId !== ctx.chatId) continue;
      const idMatch = String(p.dedupe_key ?? "").match(/^image:(.+)$/);
      if (!idMatch) continue;
      const cap = String(p.caption ?? p.text ?? "");
      const numMatch = cap.match(/^\s*(\d{1,2})[.)]/);
      if (!numMatch) continue;
      const pos = parseInt(numMatch[1], 10);
      if (!byPosition.has(pos)) byPosition.set(pos, idMatch[1]);
    }
    if (!byPosition.size) return [];
    const maxPos = Math.max(...byPosition.keys());
    const sorted: CatalogProduct[] = [];
    for (let i = 1; i <= maxPos; i++) {
      const id = byPosition.get(i);
      const cmdForPos = data.find((cmd: any) => {
        const p = cmd?.payload ?? {};
        const cap = String(p.caption ?? p.text ?? "");
        return p.chatId === ctx.chatId && String(p.dedupe_key ?? "") === `image:${id}` && cap.match(new RegExp(`^\\s*${i}[.)]`));
      });
      const snapshot = cmdForPos?.payload?.product as CatalogProduct | undefined;
      const prod = id ? ((await getCatalogProduct(ctx.catalogCfg, id)) ?? snapshot ?? null) : null;
      sorted[i - 1] = prod as CatalogProduct;
    }
    return sorted;
  } catch (err) {
    console.warn("[loadRecentlyShownProducts] falló", err);
    return [];
  }
}

/**
 * Devuelve el ÚLTIMO producto cuya imagen se le envió al cliente (la señal más
 * fiable de "qué producto está pidiendo"). Si el cliente eligió uno por número,
 * el sistema reenvía una sola imagen de ese producto, así que el más reciente
 * coincide con el elegido. También cubre el caso de un único combo mostrado.
 */
async function loadLastSentProduct(ctx: ToolExecCtx): Promise<CatalogProduct | null> {
  if (!ctx.catalogCfg || !ctx.sessionId || !ctx.chatId) return null;
  try {
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data } = await (supabaseAdmin as any)
      .from("engine_commands")
      .select("payload, created_at")
      .eq("org_id", ctx.orgId)
      .eq("session_id", ctx.sessionId)
      .eq("type", "SEND_MEDIA")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(40);

    if (!data?.length) return null;
    for (const cmd of data) {
      const p = cmd?.payload ?? {};
      if (p.chatId !== ctx.chatId) continue;
      const idMatch = String(p.dedupe_key ?? "").match(/^image:(.+)$/);
      if (!idMatch) continue;
      const snapshot = p.product as CatalogProduct | undefined;
      const prod = (await getCatalogProduct(ctx.catalogCfg, idMatch[1])) ?? snapshot ?? null;
      if (prod) return prod;
    }
    return null;
  } catch (err) {
    console.warn("[loadLastSentProduct] falló", err);
    return null;
  }
}

/**
 * Guarda el producto en foco (el que se está conversando) en la BD para memoria persistente.
 */
async function saveFocusedProduct(ctx: ToolExecCtx, p: CatalogProduct | null): Promise<void> {
  if (!p?.id || !ctx.threadId) return;
  try {
    const { data: thread } = await (supabaseAdmin as any)
      .from("threads")
      .select("focused_product_snapshot")
      .eq("id", ctx.threadId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();

    const existingSnapshot = (thread?.focused_product_snapshot as Record<string, unknown> | null) ?? {};
    const snapshot = {
      ...existingSnapshot,
      id: p.id,
      name: p.name,
      price: p.price ?? null,
      sku: p.sku ?? null,
      image_url: p.image_url ?? null,
      video_url: p.video_url ?? null,
    };
    await (supabaseAdmin as any)
      .from("threads")
      .update({
        focused_product_id: p.id,
        focused_product_snapshot: snapshot,
        focused_updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.threadId)
      .eq("org_id", ctx.orgId);
  } catch (err) {
    console.warn("[saveFocusedProduct] no se pudo guardar el foco", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Carga el producto en foco guardado; expira a 6h; enriquece desde catálogo si es posible, fallback a snapshot.
 */
async function loadFocusedProduct(ctx: ToolExecCtx): Promise<CatalogProduct | null> {
  if (!ctx.threadId || !ctx.catalogCfg) return null;
  try {
    const { data: thread } = await (supabaseAdmin as any)
      .from("threads")
      .select("focused_product_id, focused_product_snapshot, focused_updated_at")
      .eq("id", ctx.threadId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();

    if (!thread?.focused_product_id) return null;

    const age = new Date().getTime() - new Date(thread.focused_updated_at).getTime();
    if (age > 6 * 60 * 60 * 1000) return null; // Expira a 6h

    try {
      const enriched = await getCatalogProduct(ctx.catalogCfg, thread.focused_product_id);
      if (enriched) return enriched;
    } catch {
      /* continúa con snapshot */
    }

    return (thread.focused_product_snapshot as CatalogProduct) ?? null;
  } catch (err) {
    console.warn("[loadFocusedProduct] falló", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Resuelve el producto en foco: desde BD persistido, o desde handoff flujo→IA (último enviado).
 */
async function resolveFocus(ctx: ToolExecCtx): Promise<CatalogProduct | null> {
  const persisted = await loadFocusedProduct(ctx);
  if (persisted) return persisted;
  const lastSent = await loadLastSentProduct(ctx);
  if (lastSent) {
    await saveFocusedProduct(ctx, lastSent);
    return lastSent;
  }
  return null;
}

/**
 * ¿La consulta menciona un producto NUEVO o se refiere al que está en foco?
 */
function mentionsFocusedProduct(query: string, product: CatalogProduct | null): boolean {
  if (!query || !product) return false;
  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const nameWords = product.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  const skuTokens = (product.sku || "").split(/[-_]/).filter((t) => t.length >= 2);
  return nameWords.some((w) => q.includes(w)) || skuTokens.some((t) => q.includes(t));
}

const normFieldKey = (s: string) =>
  String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function hasOrderProduct(data: Record<string, unknown>): boolean {
  return Object.entries(data || {}).some(([k, v]) => {
    const nk = normFieldKey(k);
    return /(producto|articulo|art[ií]culo|item|referencia)/.test(nk) && String(v ?? "").trim().length > 0;
  });
}

function hasOrderValue(data: Record<string, unknown>): boolean {
  return Object.entries(data || {}).some(([k, v]) => {
    const nk = normFieldKey(k);
    return /(valor|precio|total|monto)/.test(nk) && String(v ?? "").trim().length > 0;
  });
}

function genericMediaReference(text: string): boolean {
  const normalized = (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const words = normalized.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const genericWords = [
    "producto",
    "articulo",
    "item",
    "ese",
    "esa",
    "esto",
    "eso",
    "aqui",
    "ahi",
    "alli",
    "otro",
    "otra",
    "mas",
    "ver",
    "muestra",
    "muestrame",
    "mostrar",
    "foto",
    "fotos",
    "imagen",
    "imagenes",
    "video",
    "videos",
    "me",
    "te",
    "lo",
    "la",
    "los",
    "las",
    "por",
    "favor",
    "porfa",
    "queria",
    "quiero",
    "dame",
    "trae",
    "quieres",
    "poder",
  ];
  return words.every((word) => genericWords.includes(word));
}

function isMoreProductsRequest(text: string): boolean {
  const t = (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return (
    (/\b(mas|otras?|otros?|diferentes|adicionales)\b/.test(t) && /\b(opciones|productos|modelos|referencias|tienes|tienen|hay|muestrame|muestra|ver)\b/.test(t)) ||
    /\balgo\s*mas\b/.test(t) ||
    /\bsolo\s+(tienes|tienen|hay)\s+(esa|ese|esas|esos|esta|este|estas|estos)\b/.test(t)
  );
}

type CatalogSearchState = {
  query: string;
  shownIds: string[];
};

async function loadCatalogSearchState(ctx: ToolExecCtx): Promise<CatalogSearchState> {
  if (!ctx.threadId) return { query: "", shownIds: [] };
  try {
    const { data: thread } = await (supabaseAdmin as any)
      .from("threads")
      .select("focused_product_snapshot")
      .eq("id", ctx.threadId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();

    const snapshot = thread?.focused_product_snapshot as Record<string, unknown> | null;
    const state = snapshot?._catalog_search as Record<string, unknown> | null;
    return {
      query: state?.query ? String(state.query).trim() : "",
      shownIds: Array.isArray(state?.shown_ids)
        ? state.shown_ids.map(String)
        : [],
    };
  } catch (err) {
    console.warn("[loadCatalogSearchState] falló", err instanceof Error ? err.message : String(err));
    return { query: "", shownIds: [] };
  }
}

async function saveCatalogSearchState(ctx: ToolExecCtx, query: string, shownIds: string[]): Promise<void> {
  if (!ctx.threadId) return;
  try {
    const { data: thread } = await (supabaseAdmin as any)
      .from("threads")
      .select("focused_product_snapshot")
      .eq("id", ctx.threadId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();

    const currentSnapshot = thread?.focused_product_snapshot as Record<string, unknown> | null;
    const snapshot = currentSnapshot ? { ...currentSnapshot } : {};
    snapshot._catalog_search = {
      query,
      shown_ids: Array.from(new Set(shownIds)),
      updated_at: new Date().toISOString(),
    };

    await (supabaseAdmin as any)
      .from("threads")
      .update({ focused_product_snapshot: snapshot })
      .eq("id", ctx.threadId)
      .eq("org_id", ctx.orgId);
  } catch (err) {
    console.warn("[saveCatalogSearchState] falló", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Completa el pedido con el producto y su valor tomados del contexto de la
 * conversación cuando el form_data no los trae. Así el pedido nunca queda con
 * "Producto: -" si el cliente venía hablando de un producto concreto.
 */
async function enrichOrderWithProduct(
  data: Record<string, unknown>,
  ctx: ToolExecCtx,
): Promise<Record<string, unknown>> {
  const out = { ...(data || {}) };
  const needProduct = !hasOrderProduct(out);
  const needValue = !hasOrderValue(out);
  if (!needProduct && !needValue) return out;

  let prod: CatalogProduct | null = await loadLastSentProduct(ctx);
  if (!prod) {
    const shown = (ctx.lastProducts ?? []).filter(Boolean) as CatalogProduct[];
    if (shown.length === 1) prod = shown[0];
  }

  if (prod) {
    if (needProduct) {
      out["Producto"] = prod.sku ? `${prod.name} (${prod.sku})` : prod.name;
    }
    if (needValue && prod.price != null && String(prod.price).trim() !== "") {
      out["Valor"] = String(prod.price);
    }
  }
  return out;
}

async function resolveProductForSend(
  args: Record<string, unknown>,
  ctx: ToolExecCtx,
): Promise<CatalogProduct | null> {
  if (!ctx.catalogCfg) return null;
  const ref = String(args.product_reference || args.product_id || "").trim();
  if (!ref) return null;

  const directFromList = (ctx.lastProducts ?? []).find((p) => String(p?.id) === ref);
  if (directFromList) return directFromList;

  // Selección por número/posición contra la última lista mostrada (determinístico).
  const posSel = parseSelectionNumber(ref);
  if (posSel != null && ctx.lastProducts && ctx.lastProducts[posSel - 1]) {
    return ctx.lastProducts[posSel - 1];
  }

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
  dedupeKey?: string,
  productSnapshot?: CatalogProduct,
) {
  if (!ctx.sessionId || !ctx.chatId) {
    return "Falta sessionId/chatId; no se puede enviar media.";
  }

  // Anti-duplicado entre ejecuciones: si ya encolamos este mismo producto a este
  // mismo chat en los últimos 2 minutos, no lo reenviamos. Esto evita que la IA
  // mande "dos rondas" de las mismas imágenes cuando hay reintentos o eventos
  // duplicados de la extensión.
  const key = dedupeKey || mediaUrl;
  try {
    const since = new Date(Date.now() - 120_000).toISOString();
    const { data: recent } = await (supabaseAdmin as any)
      .from("engine_commands")
      .select("id, payload, created_at")
      .eq("org_id", ctx.orgId)
      .eq("session_id", ctx.sessionId)
      .eq("type", "SEND_MEDIA")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(40);

    const dup = (recent ?? []).some((c: any) => {
      const p = c?.payload ?? {};
      return p.chatId === ctx.chatId && (p.dedupe_key === key || p.source_media_url === mediaUrl);
    });

    if (dup) {
      return `${kind === "video" ? "Video" : "Imagen"} ya fue enviado recientemente; se omite el duplicado.`;
    }
  } catch {
    // Si la verificación falla, continuamos (mejor enviar que bloquear).
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
      const dlMime = (dl.mimeType || "").toLowerCase();

      // Validar que lo descargado sea realmente media del tipo pedido.
      const isHtmlOrText =
        dlMime.startsWith("text/") ||
        dlMime.includes("html") ||
        dlMime.includes("json") ||
        dlMime.includes("xml");
      const mismatchedKind =
        (kind === "video" && dlMime.startsWith("image/")) ||
        (kind === "image" && dlMime.startsWith("video/"));

      if (isHtmlOrText || mismatchedKind) {
        const detalle = dlMime || "desconocido";
        return `INVALID_MEDIA: el ${kind === "video" ? "video" : "la imagen"} del producto no es un archivo de ${kind === "video" ? "video" : "imagen"} válido (tipo recibido: ${detalle}).`;
      }

      if (dlMime && dlMime !== "application/octet-stream") mimeType = dl.mimeType;
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
      console.warn(`[ai.queueOutgoingMedia] No se pudo copiar ${kind}; se enviará URL original:`, msg);
      finalUrl = mediaUrl;
    }
  }

  const payload: Record<string, unknown> = {
    chatId: ctx.chatId,
    mediaUrl: finalUrl,
    mimeType,
    caption: caption || "",
    text: caption || "",
    dedupe_key: key,
    source_media_url: mediaUrl,
    product: productSnapshot
      ? {
          id: productSnapshot.id,
          name: productSnapshot.name,
          price: productSnapshot.price,
          sku: productSnapshot.sku,
          image_url: productSnapshot.image_url,
          video_url: productSnapshot.video_url,
          description: productSnapshot.description,
          stock: productSnapshot.stock,
          badge: productSnapshot.badge,
          attributes: productSnapshot.attributes,
        }
      : undefined,
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
  if (error) {
    console.error(`[ai.queueOutgoingMedia] Error encolando ${kind}`, error.message);
    return `Error encolando ${kind}: ${error.message}`;
  }
  return `${kind === "video" ? "Video" : "Imagen"} enviado al cliente.`;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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

    const isNonEmptyValue = (value: unknown) => {
      if (value === null || value === undefined) return false;
      if (typeof value === "string") return value.trim().length > 0;
      if (typeof value === "number" || typeof value === "boolean") return true;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "object") return Object.keys(value).length > 0;
      return false;
    };

    const isRecoveryOnlyKey = (key: string) => {
      const normalized = key.trim().toLowerCase();
      return [
        "origen",
        "_source_message_id",
        "source_message_id",
        "confirmación cliente",
        "confirmación cliente",
        "resumen mostrado al cliente",
        "respuesta de confirmación enviada",
        "historial reciente",
        "registrado en",
        "origin",
      ].includes(normalized);
    };

    const hasValidOrderFields = (data: Record<string, unknown>) => {
      const keys = Object.keys(data || {});
      if (!keys.length) return false;
      return keys.some((key) => {
        if (isRecoveryOnlyKey(key)) return false;
        return isNonEmptyValue(data[key]);
      });
    };

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
    } else if (!hasValidOrderFields(formData || {})) {
      result = "Datos del pedido inválidos o incompletos: form_data debe contener al menos un campo de pedido válido.";
      details = "form_data inválido o vacío";
    } else {
      // Completar producto y valor desde el contexto si el form_data no los trae,
      // para que el pedido nunca quede con "Producto: -".
      formData = await enrichOrderWithProduct(formData || {}, ctx);
      // Evitar duplicados: si ya hay un pedido confirmado en este hilo con los mismos datos o en un corto intervalo.
        const isRecoveryFormData = (data: Record<string, unknown>) => {
        const origin = String(data?.Origen ?? data?._source_message_id ?? data?.origin ?? "");
        return origin.includes("Recuperación automática") || origin.includes("Reparación automática") || Boolean(data?._source_message_id);
      };

      if (threadId) {
        const { data: existingOrders, error: existingError } = await (supabaseAdmin as any)
          .from("orders")
          .select("id, form_data, created_at")
          .eq("org_id", orgId)
          .eq("thread_id", threadId)
          .eq("status", "confirmed")
          .order("created_at", { ascending: false });

        const parseFormData = (value: unknown): Record<string, unknown> => {
          if (typeof value === "string") {
            try {
              return value.trim() ? JSON.parse(value) : {};
            } catch {
              return {};
            }
          }
          if (typeof value === "object" && value !== null) {
            return value as Record<string, unknown>;
          }
          return {};
        };

        if (!existingError && Array.isArray(existingOrders) && existingOrders.length) {
          const normalizedFormData = (formData || {}) as Record<string, unknown>;
          const newIsRecovery = isRecoveryFormData(normalizedFormData);

          const existingOrder = existingOrders.find((order) => {
            const existing = parseFormData(order.form_data);
            return !isRecoveryFormData(existing);
          }) ?? existingOrders[0];

          const existingData = parseFormData(existingOrder.form_data);
          const existingIsRecovery = isRecoveryFormData(existingData);
          const sameData = stableStringify(existingData) === stableStringify(normalizedFormData);

          const existingCreatedAt = new Date(existingOrder.created_at || Date.now()).getTime();
          const isRecent = Date.now() - existingCreatedAt < 5 * 60 * 1000; // 5 minutes window

          if (sameData || newIsRecovery || isRecent) {
            const mergedFormData = { ...existingData, ...normalizedFormData };
            const { error: updateError } = await (supabaseAdmin as any)
              .from("orders")
              .update({ form_data: mergedFormData, status: "confirmed" })
              .eq("id", existingOrder.id)
              .eq("org_id", orgId);

            if (updateError) {
              result = `Error actualizando el pedido: ${updateError.message}`;
              details = `orders update failed: ${updateError.message}`;
              return { name, result };
            }

            await (supabaseAdmin as any)
              .from("threads")
              .update({ purchase_intent: "compro" })
              .eq("id", threadId)
              .eq("org_id", orgId);

            result = "Pedido guardado exitosamente. Agradece al cliente y confirma que su pedido está en proceso.";
            details = `Pedido existente actualizado/fusionado (id ${existingOrder.id}) para hilo ${threadId}.`;
            return { name, result };
          }
        }
      }

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
        const isUniqueViolation =
          (insertError as any)?.code === "23505" ||
          /duplicate key|unique constraint/i.test(insertError.message || "");

        if (isUniqueViolation && threadId) {
          const { data: existing } = await (supabaseAdmin as any)
            .from("orders")
            .select("id, form_data")
            .eq("org_id", orgId)
            .eq("thread_id", threadId)
            .eq("status", "confirmed")
            .order("created_at", { ascending: false })
            .limit(1);

          if (Array.isArray(existing) && existing.length) {
            let existingData: Record<string, unknown> = {};
            try {
              existingData = typeof existing[0].form_data === "string"
                ? JSON.parse(existing[0].form_data || "{}")
                : existing[0].form_data ?? {};
            } catch {
              existingData = {};
            }

            const mergedFormData = { ...existingData, ...((formData || {}) as Record<string, unknown>) };

            const { error: updateError } = await (supabaseAdmin as any)
              .from("orders")
              .update({ form_data: mergedFormData, status: "confirmed" })
              .eq("id", existing[0].id)
              .eq("org_id", orgId);

            if (updateError) {
              result = `Error guardando el pedido: ${updateError.message}`;
              details = `error al insertar pedidos (update fallback failed): ${updateError.message}`;
            } else {
              await (supabaseAdmin as any)
                .from("threads")
                .update({ purchase_intent: "compro" })
                .eq("id", threadId)
                .eq("org_id", orgId);
              result = "Pedido guardado exitosamente. Agradece al cliente y confirma que su pedido está en proceso.";
              details = `Pedido fusionado tras choque de índice único para hilo ${threadId}.`;
            }
          } else {
            result = `Error guardando el pedido: ${insertError.message}`;
            details = `error al insertar pedidos: ${insertError.message}`;
          }
        } else {
          result = `Error guardando el pedido: ${insertError.message}`;
          details = `error al insertar pedidos: ${insertError.message}`;
        }
      } else {
        await (supabaseAdmin as any)
          .from("threads")
          .update({ purchase_intent: "compro" })
          .eq("id", threadId)
          .eq("org_id", orgId);
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
        const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 6);
        const products = await searchCatalog(catalogCfg, q, limit);
        ctx.lastProducts = products;
        if (q && products.length) {
          await saveCatalogSearchState(
            ctx,
            q,
            products.map((product) => product.id),
          );
        }

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
            // Numeramos el producto según su posición en la última búsqueda para
            // que el cliente pueda identificarlo ("quiero el 2"). Si no está en la
            // lista, no anteponemos número.
            const listIdx = (ctx.lastProducts ?? []).findIndex((x) => x?.id === p.id);
            const numberPrefix = kind === "image" && listIdx >= 0 ? `${listIdx + 1}. ` : "";
            const baseCaption = (args.caption as string) || `${p.name} — $${p.price || ""}`;
            // Evitar doble numeración si el modelo ya la incluyó.
            const caption = /^\s*\d+[\.\)]/.test(baseCaption) ? baseCaption : `${numberPrefix}${baseCaption}`;

            const dedupeKey = `${kind}:${p.id}`;
            const sendResult = await queueOutgoingMedia(ctx, kind, url, caption, dedupeKey, p);

            if (sendResult.includes("se omite el duplicado")) {
              result = sendResult;
            } else if (sendResult.startsWith("INVALID_MEDIA")) {
              if (kind === "video" && p.image_url) {
                result = `El video del producto "${p.name}" no se puede enviar (el archivo no es un video válido). Envía la imagen con send_product_image (product_id="${p.id}") y ofrece detalles por texto. NO afirmes que enviaste el video.`;
              } else {
                result = `No se pudo enviar ${kind === "video" ? "el video" : "la imagen"} de "${p.name}" porque el archivo no es válido. Ofrece detalles por texto. NO afirmes que lo enviaste.`;
              }
            } else if (!/enviado al cliente/i.test(sendResult)) {
              result = sendResult;
            } else {
              // Enriquecer el resultado con contexto útil para el modelo
              const hasVideo = !!p.video_url;
              const hasImage = !!p.image_url;
              const videoNote = kind === "image" && hasVideo ? ` [Este producto TIENE video disponible — si el cliente lo pide, usa send_product_video con product_id="${p.id}"]` : "";
              result = `${kind === "video" ? "Video" : "Imagen"} enviado al cliente. Producto #${listIdx >= 0 ? listIdx + 1 : "?"}: "${p.name}" (id: ${p.id})${videoNote}`;
            }
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

function normalizeCatalogQuery(text: string): string {
  let t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  t = t.replace(/[.?¡¿!,;:]/g, " ").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ");
  t = t.replace(/\b(tienes|tiene|tienen|hay|busco|buscar|busca|quiero|necesito|me\s+muestras|muestrame|mostrar|ver|vendes|venden|consigo|tendras|tendrian|manejan|maneja|por\s+favor|porfa|porfis|mandame|enviarme|pasame|compartirme|hola|buenas|tardes|dias|noches|gracias|ok|okay|listo|dale|si|sí)\b/gi, " ");
  // Palabras "meta": describen lo que se pide SOBRE el producto, no el producto.
  t = t.replace(/\b(video|videos|foto|fotos|imagen|imagenes|informacion|info|detalle|detalles|caracteristica|caracteristicas|especificacion|especificaciones|precio|precios|disponible|disponibles|stock|mas|mejor)\b/gi, " ");
  // Palabras vagas / demostrativos que impiden detectar productos nuevos
  t = t.replace(/\b(algun|alguno|alguna|algunos|algunas|como|se|ve|asi|eso|esto|esta|este|estos|estas|ese|esa|esos|esas|aqui|ahi|alli|mismo|igual|tan|muy|me|te|le|al|es|son)\b/gi, " ");
  t = t.replace(/\b(un|uno|una|unos|unas|el|la|los|las|de|del|para|con|en|sobre|y|o|u|que|lo)\b/gi, " ");
  return t.replace(/\s+/g, " ").trim();
}

/** Detecta cuando el cliente pide ver el VIDEO/FOTO de un producto. */
function isMediaRequest(text: string): boolean {
  const t = (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(video|videos|foto|fotos|imagen|imagenes)\b/.test(t);
}

/**
 * Extrae posibles referencias de producto (SKU/modelo o nombre destacado) de un texto.
 */
function extractProductReferencesFromText(text: string): string[] {
  const refs: string[] = [];
  if (!text) return refs;
  const skuRe = /\b([A-Z]{2,6}[- ]?\d{2,5}(?:-\d{1,3})?|\d{3,5}-\d{1,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = skuRe.exec(text)) !== null) refs.push(m[1].trim());
  const upperRe = /\b([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9]{2,}(?:\s+[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9-]+){0,4})\b/g;
  while ((m = upperRe.exec(text)) !== null) {
    const phrase = m[1].trim();
    if (phrase.length >= 4 && !/^(JDM|MNS|SKU|WHATSAPP|IA)$/.test(phrase)) refs.push(phrase);
  }
  return refs;
}

async function queueOutgoingText(ctx: ToolExecCtx, text: string) {
  if (!ctx.sessionId || !ctx.chatId || !text.trim()) return;
  const cmdId = (globalThis.crypto?.randomUUID?.() ?? `cmd_${Date.now()}_${Math.random()}`) as string;
  try {
    await (supabaseAdmin as any).from("messages").insert({
      org_id: ctx.orgId,
      thread_id: ctx.threadId,
      direction: "out",
      text,
      wa_message_id: `pending-${cmdId}`,
      sent_at: new Date().toISOString(),
    });
    await (supabaseAdmin as any).from("engine_commands").insert({
      id: cmdId,
      org_id: ctx.orgId,
      session_id: ctx.sessionId,
      type: "SEND_MESSAGE",
      payload: { chatId: ctx.chatId, text },
      status: "pending",
    });
  } catch (err) {
    console.error("[queueOutgoingText] no se pudo encolar texto", err instanceof Error ? err.message : String(err));
  }
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
  let catalogCfg, threadRow, orderFieldsData, knowledgeSourcesData;
  
  // Envolver todas las queries de BD en try-catch
  try {
    // Cargar integración de catálogo (si está activa)
    catalogCfg = await getCatalogConfig(orgId);
  } catch (err) {
    console.error('[runAiAgent] getCatalogConfig failed', err, { orgId });
    catalogCfg = null;
  }

  // Cargar thread con manejo de error
  try {
    const result = await supabaseAdmin
      .from('threads')
      .select('purchase_intent')
      .eq('id', threadId)
      .maybeSingle();
    threadRow = result.data;
  } catch (err) {
    console.error('[runAiAgent] threads query failed', err, { threadId, orgId });
    threadRow = null;
  }
  
  const purchaseIntent = (threadRow as any)?.purchase_intent || 'none';
  const isCollectingOrder = purchaseIntent === 'collecting_data';
  const orderStateText = `\n\n=== ESTADO ACTUAL DEL THREAD ===\nestado_pedido: ${purchaseIntent}\n${
    isCollectingOrder
      ? 'El cliente ESTÁ entregando datos del pedido. NO busques productos: pide el siguiente dato faltante o ejecuta confirm_order si ya tienes todo.'
      : 'El cliente NO está en modo recolección de datos. Atiende normalmente según la jerarquía de modos.'
  }`;

  const ctx: ToolExecCtx = { orgId, threadId, contactId, sessionId, chatId, catalogCfg };
  const visibleChat = messages.filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim());
  const lastUserText = [...visibleChat].reverse().find((m) => m.role === "user")?.content?.trim() ?? "";

  const previousDetailQuestion = [...visibleChat]
    .reverse()
    .filter((m) => m.role === "user" && m.content?.trim() !== lastUserText)
    .find((m) => isProductDetailQuestion(m.content))?.content?.trim() ?? "";

  const detailQuestionText = isProductDetailQuestion(lastUserText)
    ? lastUserText
    : /^(\?+|¿\?+|\?\?|y\??|me responde\??|me confirmas\??)$/i.test(lastUserText.trim())
    ? previousDetailQuestion || lastUserText
    : lastUserText;

  // Reconstruir los productos mostrados recientemente para poder resolver
  // selecciones por número ("la 3") entre turnos.
  ctx.lastProducts = await loadRecentlyShownProducts(ctx);

  // Resolver el producto en foco (memoria persistente del producto conversado)
  const focusedProduct = await resolveFocus(ctx);

  const resolveProductFromConversation = async (): Promise<CatalogProduct | null> => {
    if (!catalogCfg) return null;
    const recent = [...visibleChat].reverse().slice(0, 8);
    for (const msg of recent) {
      const refs = extractProductReferencesFromText(msg.content);
      refs.sort((a, b) => (/\d/.test(b) ? 1 : 0) - (/\d/.test(a) ? 1 : 0)); // SKUs primero
      for (const ref of refs) {
        const hits = await searchCatalog(catalogCfg, ref, 3);
        const match = resolveProductFromReference(ref, hits) ?? hits[0];
        if (match) return match;
      }
    }
    return null;
  };

  const resolveCurrentProductForDetails = async (): Promise<CatalogProduct | null> => {
    if (!catalogCfg || !isProductDetailQuestion(detailQuestionText)) return null;
    for (const msg of [...visibleChat].reverse()) {
      if (msg.role === "user") {
        const sel = parseSelectionNumber(msg.content);
        if (sel != null && ctx.lastProducts?.[sel - 1]) return ctx.lastProducts[sel - 1];
      }
      const chosenMatch = msg.content.match(/(?:buena elecci[oó]n|excelente elecci[oó]n)[\s\S]{0,80}?\b(?:el|la)\s+([^\n🙌😊.]+)/i);
      if (chosenMatch) {
        const hits = await searchCatalog(catalogCfg, chosenMatch[1].trim(), 3);
        if (hits[0]) return hits[0];
      }
    }
    return focusedProduct ?? (await loadLastSentProduct(ctx)) ?? (await resolveProductFromConversation());
  };

  const selectedProductForDetails = await resolveCurrentProductForDetails();
  const storedCatalogState = await loadCatalogSearchState(ctx);
  const currentCatalogQuery = normalizeCatalogQuery(lastUserText);
  const wantsMoreProducts = isMoreProductsRequest(lastUserText);
  const mediaRequest = isMediaRequest(lastUserText);
  const catalogQuery = currentCatalogQuery || (wantsMoreProducts ? storedCatalogState.query : "");
  const hasCatalogKeyword = /\b(cat[aá]logo|producto|productos|modelo|modelos|foto|fotos|imagen|im[aá]genes|precio|precios|stock|disponible|referencia|combo|plancha|secador|cepillo)\b/i.test(lastUserText);
  const hasSearchIntent = /\b(tienes|tiene|tienen|hay|busco|buscar|busca|quiero|necesito|me\s+muestras|mu[eé]strame|mostrar|ver|vende[ns]?|venden|consigo|tendr[aá]s|tendr[ií]an|manejan|maneja)\b/i.test(lastUserText);
  const looksLikeDirectProductSearch = !!catalogCfg && !!catalogQuery && catalogQuery.length >= 4;
  
  ctx.catalogSearchQuery = catalogQuery || null;

  // Intención de COMPRA/PEDIDO sobre el producto que ya se venía conversando.
  // Estas frases NO deben disparar una búsqueda de catálogo (ej. "quiero hacer el
  // pedido" no debe buscar "hacer" y traer máquinas de ejercicio). Debe entrar al
  // flujo de pedido manteniendo el contexto del producto elegido.
  const isOrderIntent = /\b(hacer (el |un |mi )?pedido|el pedido|mi pedido|agendar(lo| el pedido| mi pedido)?|como lo (pido|compro|adquiero|ordeno)|lo (quiero|deseo) (comprar|pedir|llevar)|quiero (comprar|pedir|ordenar|agendar)|deseo (comprar|pedir|hacer (el |un )?pedido|agendar)|me lo llevo|lo llevo|lo compro|finalizar (la )?compra|proceder con (el |la )?(pedido|compra))\b/i.test(lastUserText);
  
  const isCatalogQuestion = !isOrderIntent && !mediaRequest && !wantsMoreProducts && (hasCatalogKeyword || (!!catalogCfg && !!catalogQuery && (hasSearchIntent || hasCatalogKeyword || looksLikeDirectProductSearch) && !isProductDetailQuestion(lastUserText)));
  
  // Producto de contexto para el flujo de pedido: prioriza foco, luego elegido, luego último mostrado.
  const orderContextProduct = isOrderIntent && !selectedProductForDetails && catalogCfg
    ? (focusedProduct ?? (await loadLastSentProduct(ctx)) ?? ctx.lastProducts?.filter(Boolean).slice(-1)[0] ?? null)
    : null;
  const startOrderFlow = isOrderIntent && !isCollectingOrder && !!(selectedProductForDetails || orderContextProduct);

  const promptMode = isCollectingOrder
    ? "pedido"
    : startOrderFlow
    ? "pedido"
    : selectedProductForDetails
    ? "product_detail"
    : isCatalogQuestion
    ? "catalog"
    : "general";

  const tools = promptMode === "pedido" || promptMode === "product_detail"
    ? CRM_TOOLS
    : catalogCfg ? [...CRM_TOOLS, ...CATALOG_TOOLS] : CRM_TOOLS;

  const PRODUCT_FLOW_GUIDE = `
Eres un asistente comercial por WhatsApp. Tu objetivo es ATENDER, AGENDAR/PREPARAR PEDIDOS y MOSTRAR PRODUCTOS cuando corresponda.

MODO A — RECOPILANDO DATOS DEL PEDIDO:
1. Si estado_pedido indica "collecting_data", NO llames search_products ni envíes imágenes nuevas.
2. Pide el siguiente dato requerido del pedido con una sola pregunta breve.
3. Si ya tienes todos los datos y el cliente confirma explícitamente, ejecuta la herramienta confirm_order con form_data como JSON EN ESTE MISMO TURNO. Si no lo haces, no completes la conversación ni digas que el pedido está registrado.
4. NO digas que el pedido está registrado o confirmado sin ejecutar confirm_order.
5. Solo sal de este modo si el cliente cambia de tema y vuelve a preguntar por productos.

MODO B — DESCUBRIENDO PRODUCTOS:
1. Cuando el cliente pregunta por catálogo, modelos, fotos, videos, precios, stock o referencias, llama primero a search_products con la palabra clave.
2. Si hay resultados, responde enviando imágenes de los mejores 6 productos usando send_product_image una vez por producto. NUNCA envíes el mismo producto dos veces ni repitas la búsqueda.
3. El caption de cada imagen debe ser corto, EMPEZAR con el número de la lista, y contener nombre y precio: "<n>. <nombre> — $<precio>" (ej. "1. Zapatero 6 niveles — $32200"). El número permite que el cliente elija diciendo "quiero el 2".
4. Después de enviar las imágenes, escribe un mensaje corto y natural invitando al cliente a elegir o preguntar más. Evita listados de texto.
5. Si el cliente elige un producto por descripción (por ejemplo "el de 6 niveles", "el JDM-128"), usa send_product_image con product_reference exactamente como lo dijo.
6. SI TIENES INFORMACIÓN DE UN VIDEO DISPONIBLE para el producto actual:
   a. Menciona que tienes video disponible (por ejemplo: "También tengo un video donde puedes verlo mejor 😊" o "¿Te gustaría verlo?")
   b. ESPERA la respuesta del cliente.
   c. Si el cliente confirma (sí, si, claro, ok, dale, etc.), EJECUTA INMEDIATAMENTE send_product_video con el product_id o product_reference del producto en cuestión.
   d. NO digas que enviarás video — directamente EJECUTA la herramienta send_product_video DENTRO DEL MISMO TURNO.
   e. Si el cliente dice que no, continúa normalmente sin enviar video.

- Si ya mostraste hasta 6 imágenes de productos y el cliente elige uno, envía SÓLO una imagen adicional del producto elegido y agrega el valor de envío en ese mensaje. No repitas varias imágenes adicionales.
- Al confirmar el producto seleccionado, menciona claramente el valor de envío junto al precio final.
7. Si el cliente pide video DIRECTAMENTE (ej: "¿tienes video de esto?", "muéstrame video"), LLAMA send_product_video INMEDIATAMENTE sin esperar confirmación adicional.
8. Si no hay video disponible, dilo y ofrece alternativamente send_product_image o detalles en texto.

MODO C — CUANDO FALTA INFORMACIÓN EXACTA (CARACTERÍSTICAS, ESPECIFICACIONES, DETALLES):
1. Si el cliente pregunta por características, especificaciones, detalles técnicos o información que NO está en tu BASE DE CONOCIMIENTO:
   a. NO inventa datos ni utiliza herramientas inexistentes.
   b. Responde con lo que sí aparece en el catálogo / base de conocimiento.
   c. Si el dato exacto no está cargado, dilo breve y ofrece verificarlo: "Ese dato exacto no lo tengo cargado, te lo verifico 😊".
2. Ejemplos de preguntas que activan este modo:
   - "¿Qué material es?" / "¿De qué color viene?" / "¿Cuánto pesa?"
   - "¿Tiene garantía?" / "¿Cuál es la dimensión exacta?"
   - Cualquier pregunta sobre especificaciones no listadas en el catálogo.
3. IMPORTANTE: NUNCA pide datos de contacto al cliente cuando falta información.
`;

  const activeFlowGuide = promptMode === "catalog"
    ? PRODUCT_FLOW_GUIDE
    : promptMode === "product_detail"
      ? `MODO DETALLE DE PRODUCTO:\n1. El cliente pregunta por el producto ya elegido; NO busques otros productos ni envíes otra ronda de imágenes.\n2. Responde usando PRODUCTO ELEGIDO y la BASE DE CONOCIMIENTO relevante.\n3. Si un dato exacto no existe en el contexto, dilo de forma breve y ofrece verificarlo.\n4. Cierra con una sola pregunta de venta suave.`
      : promptMode === "pedido"
        ? `MODO PEDIDO:\n1. No busques productos nuevos.\n2. Interpreta los datos del pedido en cualquier formato.\n3. Pide solo el dato requerido faltante.\n4. Si todos los datos están y el cliente confirma, usa confirm_order.`
        : `MODO GENERAL:\nResponde breve y natural. Si el cliente pregunta por productos, usa el catálogo; si muestra intención de compra, guía hacia el pedido.`;

  // Load order fields con manejo de error
  try {
    const result = await supabaseAdmin
      .from("order_fields")
      .select("name, is_required")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true });
    orderFieldsData = result.data;
  } catch (err) {
    console.error('[runAiAgent] order_fields query failed', err, { orgId });
    orderFieldsData = null;
  }
    
  const orderFields = orderFieldsData ?? [];
  const orderFieldsText = orderFields.length 
    ? `\n\n=== RECOPILACIÓN DE PEDIDOS (OBLIGATORIO) ===\n1. Detecta intención de compra y pregunta si deseas agendar o hacer el pedido.\n2. Si el cliente dice SÍ, confirma o indica que quiere continuar, envía EXACTAMENTE este mensaje para pedir sus datos:\n"Para agendar su pedido por favor indíqueme:\n${orderFields.map((f: any) => `* ${f.name}${f.is_required ? '' : ' (opcional)'}`).join('\n')}"\n3. INTERPRETA LOS DATOS EN CUALQUIER FORMATO: el cliente puede enviarlos con etiquetas ("Nombre: Juan"), separados por "/" o por comas, o cada dato en una línea distinta sin rótulos. Mapea cada valor al campo correcto sin importar el formato y NO le pidas que los reescriba.\n4. Si después de interpretar falta algún dato REQUERIDO, pide ÚNICAMENTE el dato que falta, de forma breve y cortés, una sola pregunta por mensaje, y repite solo hasta que el cliente entregue todos los datos requeridos. No avances ni confirma mientras falten datos requeridos.\n5. SIEMPRE incluye en el form_data el PRODUCTO que el cliente está comprando (nombre/referencia del producto que se venía conversando o que eligió) y su VALOR/precio. Si el cliente no mencionó el producto explícitamente, use el último producto mostrado en la conversación. Usa las claves "Producto" y "Valor".\n6. Cuando tengas TODOS los datos requeridos (incluido Producto y Cantidad), muestra un resumen claro con el producto, valor y datos del cliente, y pregunta: "¿La información es correcta para confirmar su pedido?"\n7. SOLO cuando el cliente confirma explícitamente, ejecuta la herramienta confirm_order con form_data como JSON (incluido Producto y Valor). NO digas "pedido registrado" ni confirma el pedido si no ejecutas confirm_order.\n8. El único mecanismo válido para guardar el pedido en el sistema es llamar a la herramienta confirm_order. Si no la ejecutas, no se puede considerar el pedido confirmado.\n9. Después de ejecutar confirm_order, responde algo como: "Pedido registrado correctamente. Gracias, su pedido está en proceso".`
    : "";

  // Load knowledge sources con manejo de error
  try {
    const result = await supabaseAdmin
      .from("knowledge_sources")
      .select("name, source_type, content")
      .eq("org_id", orgId)
      .eq("is_active", true);
    knowledgeSourcesData = result.data;
  } catch (err) {
    console.error('[runAiAgent] knowledge_sources query failed', err, { orgId });
    knowledgeSourcesData = null;
  }

  const intentSelection = selectRelevantKnowledgeSources(lastUserText, (knowledgeSourcesData as any[]) ?? []);
  const sourcesToUse = intentSelection?.matched ?? ((knowledgeSourcesData as any[]) ?? []);
  const hasIntentMatch = !!intentSelection;

  const KS_PER_SOURCE = hasIntentMatch ? 1400 : promptMode === "general" ? 900 : 500;
  const KS_TOTAL = hasIntentMatch ? 2000 : promptMode === "general" ? 3000 : promptMode === "pedido" ? 800 : 1500;
  const knowledgeSourcesText = (() => {
    if (!sourcesToUse.length) return "";
    let used = 0;
    const blocks: string[] = [];
    for (const ks of sourcesToUse as any[]) {
      if (used >= KS_TOTAL) break;
      const remaining = KS_TOTAL - used;
      const body = selectRelevantText(String(ks.content ?? ""), lastUserText, Math.min(KS_PER_SOURCE, remaining));
      if (!body.trim()) continue;
      blocks.push(`[Tipo: ${ks.source_type} | Nombre: ${ks.name}]\n${body}`);
      used += body.length;
    }
    if (!blocks.length) return "";
    const header = hasIntentMatch
      ? `\n\n=== CONOCIMIENTO RELEVANTE (intención: ${intentSelection!.intent}) ===\n`
      : "\n\n=== FUENTES DE CONOCIMIENTO ADICIONALES ===\n";
    return header + blocks.join("\n\n");
  })();

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
- Usa siempre la BASE DE CONOCIMIENTO / PRODUCTOS y el prompt del sistema como referencia prioritaria antes de inventar respuestas.
- Haz MÁXIMO UNA (1) pregunta por mensaje. NUNCA hagas dos preguntas en el mismo mensaje.
- Antes de responder, analiza el historial completo y usa el contexto previo para validar qué producto o necesidad está preguntando el cliente.
- Sé breve y directo. Respuestas cortas. No más de 3 líneas salvo que el cliente pida detalle.
- NUNCA te presentes ni digas tu nombre si ya hay mensajes previos en la conversación.
- NUNCA repitas preguntas que ya hiciste antes en el historial.
- Si el cliente ya mostró interés en algo, continúa desde ahí sin empezar de cero.
- Si el cliente confirma la información del pedido, llama obligatoriamente la herramienta \`confirm_order\` y no digas "pedido registrado" hasta que esa herramienta se ejecute.`;

  const intentIsProduct = intentSelection?.intent.includes("product") ?? false;
  const KB_MAX = hasIntentMatch && !intentIsProduct
    ? 600
    : promptMode === "general" ? 4000 : promptMode === "catalog" ? 1800 : promptMode === "product_detail" ? 2500 : 1200;
  const knowledgeBaseRaw = (cfg.knowledge_base as string)?.trim() || "";
  const knowledgeBase = selectRelevantText(knowledgeBaseRaw, `${detailQuestionText}\n${selectedProductForDetails?.name ?? ""}\n${selectedProductForDetails?.sku ?? ""}`, KB_MAX);

  const contextProductForPrompt = selectedProductForDetails ?? orderContextProduct;
  const selectedProductText = contextProductForPrompt
    ? `\n\n=== PRODUCTO ELEGIDO / CONTEXTO PRIORITARIO ===\n${formatProductDetailsForCustomer(contextProductForPrompt)}${
        startOrderFlow
          ? "\n\nEl cliente quiere hacer el pedido de ESTE producto. NO busques otros productos ni reinicies la conversación. Continúa el flujo de pedido pidiendo los datos para agendar."
          : ""
      }`
    : "";

  const system = [
    (cfg.system_prompt as string)?.trim() || "Eres un asistente comercial útil, cercano y proactivo. Acompañas al cliente hasta que cierre una compra o decida no continuar.",
    `\n\n=== MODO DE PROMPT DINÁMICO ===\nmodo: ${promptMode}\nUsa solo el contexto incluido aquí. Para detalles del producto elegido, prioriza PRODUCTO ELEGIDO y BASE DE CONOCIMIENTO relevante; no reinicies búsqueda ni envías otra ronda de imágenes salvo que el cliente pida otros productos.`,
    conversationRulesText,
    selectedProductText,
    knowledgeBase
      ? `\n\n=== BASE DE CONOCIMIENTO / PRODUCTOS ===\n${knowledgeBase}`
      : "",
    "\n\nTienes acceso a herramientas para ayudar al cliente. Usa SIEMPRE las herramientas de catálogo para preguntas sobre producto, precio, stock, foto o video. No respondas solo con texto si puedes enviar imagen o video.",
    "\n\n" + activeFlowGuide,
    orderStateText,
    orderFieldsText,
    knowledgeSourcesText,
    dynamicContextText,
  ].join("");

  const approxPromptChars = system.length + messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  console.info("[runAiAgent] prompt size", {
    orgId,
    threadId,
    systemChars: system.length,
    historyMsgs: messages.length,
    approxPromptChars,
    approxTokens: Math.round(approxPromptChars / 4),
  });

  const msgs: Msg[] = [{ role: "system", content: system }, ...messages];

  const actions: string[] = [];
  const executedToolCalls = new Set<string>();
  let orderConfirmed = false;
  let lastText = "";
  let deliveredProductMedia = false;

  // Cortocircuito determinista de media: si el cliente pide ver VIDEO/FOTO de un producto
  if (!isCollectingOrder && catalogCfg && isMediaRequest(lastUserText) && (!catalogQuery || genericMediaReference(catalogQuery))) {
    const wantsVideo = /\b(video|videos)\b/i.test(
      lastUserText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    );
    const mediaProduct =
      selectedProductForDetails ??
      focusedProduct ??
      (await loadLastSentProduct(ctx)) ??
      ctx.lastProducts?.filter(Boolean).slice(-1)[0] ??
      (await resolveProductFromConversation());

    // Ruteo inteligente: ¿la consulta nombra un producto NUEVO o se refiere al que está en foco?
    const namesNewProduct = !!catalogQuery && catalogQuery.length >= 3 && !genericMediaReference(catalogQuery) && !mentionsFocusedProduct(catalogQuery, mediaProduct);

    if (mediaProduct && !namesNewProduct) {
      await saveFocusedProduct(ctx, mediaProduct); // Guardar foco para próximos turnos
      const kind: "video" | "image" = wantsVideo && mediaProduct.video_url ? "video" : "image";
      const url = kind === "video" ? mediaProduct.video_url : mediaProduct.image_url;

      if (wantsVideo && !mediaProduct.video_url) {
        if (mediaProduct.image_url) {
          await executeToolCall({ id: `auto_media_${mediaProduct.id}`, function: {
            name: "send_product_image",
            arguments: JSON.stringify({ product_id: mediaProduct.id, caption: `${mediaProduct.name} — $${mediaProduct.price ?? ""}` }),
          }}, ctx);
          actions.push("send_product_image");
        }
        return { reply: `Del ${mediaProduct.name} no tengo video cargado, pero te envié la imagen. ¿Quieres que te dé más detalles o lo agendamos? 😊`,
                 actions: actions.length ? actions : ["media_no_video"] };
      }

      if (url) {
        const exec = await executeToolCall({ id: `auto_media_${mediaProduct.id}`, function: {
          name: kind === "video" ? "send_product_video" : "send_product_image",
          arguments: JSON.stringify({ product_id: mediaProduct.id, caption: `${mediaProduct.name} — $${mediaProduct.price ?? ""}` }),
        }}, ctx);
        
        const sent = /enviado al cliente/i.test(exec.result);

        // Si el video no es válido, NO afirmar que se envió: fallback a imagen.
        if (kind === "video" && !sent) {
          if (mediaProduct.image_url) {
            const imgExec = await executeToolCall({ id: `auto_media_img_${mediaProduct.id}`, function: {
              name: "send_product_image",
              arguments: JSON.stringify({ product_id: mediaProduct.id, caption: `${mediaProduct.name} — $${mediaProduct.price ?? ""}` }),
            }}, ctx);
            actions.push(imgExec.name);
            return { reply: `El video del ${mediaProduct.name} no está disponible en este momento, pero te envié la imagen. ¿Quieres que te dé más detalles o lo agendamos? 😊`, actions };
          }
          return { reply: `Por ahora no puedo enviarte el video del ${mediaProduct.name}, pero con gusto te doy todos los detalles. ¿Qué te gustaría saber? 😊`, actions: actions.length ? actions : ["media_invalid_video"] };
        }

        actions.push(exec.name);
        return { reply: `Aquí tienes ${kind === "video" ? "el video" : "la imagen"} del ${mediaProduct.name}. ¿Tienes alguna consulta o te gustaría agendar el pedido? 😊`, actions };
      }
    }
    // Si no se resolvió producto, continúa el flujo normal.
  }

  if (
    !isCollectingOrder &&
    catalogCfg &&
    wantsMoreProducts &&
    storedCatalogState.query
  ) {
    const allMatches = await searchCatalog(catalogCfg, storedCatalogState.query, 60);
    const shownIds = new Set(storedCatalogState.shownIds);
    const newProducts = allMatches.filter((p) => !shownIds.has(p.id)).slice(0, 6);

    if (!newProducts.length) {
      return {
        reply: "Lo siento, por el momento no tenemos más.",
        actions: ["catalog_no_more_results"],
      };
    }

    ctx.lastProducts = newProducts;
    await saveCatalogSearchState(
      ctx,
      storedCatalogState.query,
      [...shownIds, ...newProducts.map((product) => product.id)],
    );

    for (const product of newProducts.filter((p) => p.image_url)) {
      const index = newProducts.findIndex((p) => p.id === product.id) + 1;
      const imageExec = await executeToolCall(
        {
          id: `more_img_${product.id}`,
          function: {
            name: "send_product_image",
            arguments: JSON.stringify({
              product_id: product.id,
              caption: `${index}. ${product.name} — $${product.price ?? ""}`,
            }),
          },
        },
        ctx,
      );
      actions.push(imageExec.name);
      if (/enviado al cliente/i.test(imageExec.result)) {
        deliveredProductMedia = true;
      }
    }

    return {
      reply: deliveredProductMedia
        ? `Estas son otras opciones de ${storedCatalogState.query}. ¿Te agrada alguna? 😊`
        : `Encontré más opciones de ${storedCatalogState.query}, pero no tienen imagen disponible por el momento.`,
      actions,
    };
  }

  if (!isCollectingOrder && promptMode === "catalog" && catalogCfg && catalogQuery) {
    // 1) Frase de espera ANTES de iniciar la búsqueda (no la dice la IA).
    await queueOutgoingText(ctx, "¡Claro que sí! Permíteme 2 min mientras te busco todos los que tenemos 😉");

    // 2) Búsqueda en cascada: searchCatalog ya expande términos y filtra de forma estricta.
    console.log(`[DEBUG SEARCH] lastUserText="${lastUserText}", catalogQuery="${catalogQuery}", currentCatalogQuery="${currentCatalogQuery}"`);
    const products = await searchCatalog(catalogCfg, catalogQuery, 6);
    ctx.lastProducts = products;
    console.log(`[DEBUG SEARCH] searchCatalog devolvió ${products.length} productos: ${products.map(p => `${p.id}/${p.name}`).join(", ")}`);
    console.log(`[DEBUG SEARCH] productos con image_url: ${products.filter(p => p.image_url).length}`);

    if (!products.length) {
      return {
        reply: `Por ahora no me aparecen resultados de "${catalogQuery}" en el catálogo. ¿Me das otra referencia o el nombre exacto del producto? 😊`,
        actions: ["catalog_no_exact_match"],
      };
    }

    await saveCatalogSearchState(
      ctx,
      catalogQuery,
      products.map((product) => product.id),
    );

    // 3) Enviar cada producto numerado.
    for (const product of products.filter((p) => p.image_url)) {
      const index = products.findIndex((p) => p.id === product.id) + 1;
      const imageExec = await executeToolCall(
        {
          id: `auto_img_${product.id}`,
          function: {
            name: "send_product_image",
            arguments: JSON.stringify({
              product_id: product.id,
              caption: `${index}. ${product.name} — $${product.price ?? ""}`,
            }),
          },
        },
        ctx
      );
      actions.push(imageExec.name);
      if (/enviado al cliente/i.test(imageExec.result)) deliveredProductMedia = true;
    }

    // 4) Mensaje de cierre con la palabra buscada; luego la IA queda activa.
    if (deliveredProductMedia) {
      return {
        reply: `Mira, estos son los que tenemos de ${catalogQuery}. ¿Te agrada alguno? 😊`,
        actions,
      };
    }

    const textList = products
      .slice(0, 6)
      .map((p, idx) => `${idx + 1}. ${p.name}${p.price != null ? ` — $${p.price}` : ""}`)
      .join("\n");
    return {
      reply: `Encontré estas opciones de ${catalogQuery}:\n${textList}\n\n¿Cuál te interesa? Dime el número 😊`,
      actions: ["catalog_found_without_media"],
    };
  }

  if (!isCollectingOrder && promptMode === "product_detail" && selectedProductForDetails) {
    const focusedSystem = [
      (cfg.system_prompt as string)?.trim() || "Eres un asesor comercial por WhatsApp.",
      "\n\nResponde SOLO sobre el producto elegido. Usa el catálogo y la base relevante. No inventes datos técnicos; si falta un dato exacto, dilo y ofrece verificarlo. Responde breve y vendedor, máximo 4 líneas.",
      selectedProductText,
      knowledgeBase ? `\n\n=== BASE RELEVANTE ===\n${knowledgeBase}` : "",
    ].join("");
    try {
      const focused = await callAiProvider(cfg, [
        { role: "system", content: focusedSystem },
        ...visibleChat.slice(-6),
        { role: "user", content: lastUserText },
      ]);
      if (focused.text?.trim()) {
        await saveFocusedProduct(ctx, selectedProductForDetails);
        return { reply: focused.text.trim(), actions: ["product_detail_from_catalog"] };
      }
    } catch (err) {
      console.warn("[runAiAgent] Falló el detalle del producto enfocado, se utilizará la respuesta determinista del catálogo", {
        error: err instanceof Error ? err.message : String(err),
        orgId,
        threadId,
      });
    }
    await saveFocusedProduct(ctx, selectedProductForDetails);
    return {
      reply: buildProductDetailReply(selectedProductForDetails),
      actions: ["detalle_del_producto_del_catálogo"],
    };
  }

  // DETERMINÍSTICO DE CORTOCIRCUITO: si el cliente eligió por número y no estamos
  // recopilando datos del pedido, confirmamos el producto correcto SIN llamar a
  // Vertex. Esto corrige dos fallas: (a) la IA enviaba un producto equivocado al
  // hacer fuzzy-match del número contra nombres/SKU, y (b) el timeout/429 de
  // Vertex que terminaba mostrando el fallback "dame un ratito ya te envío 😉".
  if (!isCollectingOrder && ctx.lastProducts.some(Boolean)) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const sel = lastUser ? parseSelectionNumber(lastUser.content) : null;
    if (sel != null) {
      let chosen = ctx.lastProducts[sel - 1];
      if (chosen) {
        // Enriquecer con características/beneficios completos del catálogo (la
        // lista reconstruida puede venir sin descripción ni atributos).
        if (catalogCfg && (!chosen.description && !(chosen.attributes && Object.keys(chosen.attributes).length))) {
          try {
            const full = await getCatalogProduct(catalogCfg, chosen.id);
            if (full) chosen = full;
          } catch (err) {
            console.warn("[runAiAgent] no se pudo enriquecer el producto elegido", err instanceof Error ? err.message : String(err));
          }
        }

        const details = formatProductDetailsForCustomer(chosen);
        // Guardar producto en foco (memoria persistente)
        await saveFocusedProduct(ctx, chosen);
        // Enviar las características/beneficios como UN mensaje, y la pregunta de
        // cierre como un mensaje SEPARADO (mejor lectura en WhatsApp).
        await queueOutgoingText(ctx, `¡Buena elección! 🙌\n\n${details}`);
        return {
          reply: `¿Tienes alguna consulta de lo que te acabo de enviar o del producto, o te gustaría agendar el pedido? 😊`,
          actions: ["seleccionar_detalle_del_producto"],
        };
      }
    }
  }

  const buildProductMediaFollowUp = () => {
    const imageCount = actions.filter((a) => a === "send_product_image").length;
    const videoCount = actions.filter((a) => a === "send_product_video").length;
    if (videoCount > 0) return "¿Te sirve? Si quieres lo agendamos 😊";
    if (imageCount > 1) return "¿Cuál te llama la atención? Dime el número 😊";
    return "¿Ese te sirve? Si quieres lo agendamos 😊";
  };

  const stableStringify = (value: unknown): string => {
    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      return `{${Object.keys(obj)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };

  const normalizeToolArgs = (rawArgs: unknown): string => {
    if (typeof rawArgs === "string") {
      try {
        return stableStringify(JSON.parse(rawArgs));
      } catch {
        return rawArgs;
      }
    }
    return stableStringify(rawArgs);
  };

  const toolCallSignature = (tc: { function: { name: string; arguments: string | Record<string, unknown> } }) =>
    `${tc.function.name}:${normalizeToolArgs(tc.function.arguments)}`;

  const FIELD_ALIASES: Record<string, string[]> = {
    nombre: ["nombre", "cliente", "name"],
    telefono: ["telefono", "teléfono", "celular", "movil", "móvil", "whatsapp", "tel"],
    ciudad: ["ciudad", "municipio", "localidad"],
    barrio: ["barrio", "sector"],
    direccion: ["direccion", "dirección", "domicilio", "dir"],
    cantidad: ["cantidad", "unidades", "qty", "cant"],
  };
  const normKey = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();

  // Intenta estructurar un mensaje libre del cliente en los campos del pedido.
  const extractStructuredOrderData = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!text?.trim()) return out;
    const fieldNames = orderFields.map((f: any) => String(f.name));
    // 1) Líneas tipo "Campo: valor"
    for (const raw of text.split(/\r?\n|•|·|\*/)) {
      const m = raw.match(/^\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]{2,40})\s*[:\-]\s*(.+)$/);
      if (!m) continue;
      const key = normKey(m[1]);
      const value = m[2].trim();
      if (!value) continue;
      const field = fieldNames.find((fn) => {
        const nk = normKey(fn);
        return nk === key || (FIELD_ALIASES[nk] ?? [nk]).some((a) => normKey(a) === key);
      });
      if (field && !out[field]) out[field] = value;
    }
    // 2) Volcado separado por "/" o "," mapeado posicionalmente a los campos.
    if (Object.keys(out).length < Math.min(2, fieldNames.length) && /[\/,]/.test(text)) {
      const sep = text.includes("/") ? "/" : ",";
      const parts = text.split(sep).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        fieldNames.forEach((fn, i) => {
          if (parts[i] && !out[fn]) out[fn] = parts[i].replace(/^(enviame|quiero|cantidad)\s*/i, "").trim();
        });
      }
    }
    // 3) Volcado por líneas SIN etiquetas, mapeado posicionalmente a los campos.
    // Cubre el caso real: el cliente envía cada dato en una línea distinta
    // (Nombre / Teléfono / Ciudad / Barrio / Dirección / Cantidad) sin rótulos.
    if (Object.keys(out).length < Math.min(2, fieldNames.length)) {
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.replace(/^[\s*•·\-]+/, "").trim())
        .filter(Boolean);
      if (lines.length >= 2 && lines.length <= fieldNames.length + 3) {
        fieldNames.forEach((fn, i) => {
          if (lines[i] && !out[fn]) {
            out[fn] = lines[i].replace(/^(enviame|quiero|cantidad)\s*/i, "").trim();
          }
        });
      }
    }
    return out;
  };

  const hasAllRequiredFields = (data: Record<string, string>) => {
    const requiredFields = orderFields.filter((f: any) => f.is_required);
    if (!requiredFields.length) return false;
    return requiredFields.every((f: any) => {
      const val = data[f.name];
      return val && val.trim().length > 0 && val !== "-";
    });
  };

  const isDataDump = () => {
    const visibleHistory = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
      .filter((m) => !m.content.trim().startsWith("[INSTRUCCIÓN DEL SISTEMA"));
    const lastUserIndex = visibleHistory.map((m) => m.role).lastIndexOf("user");
    if (lastUserIndex < 0) return false;
    const lastUser = visibleHistory[lastUserIndex]?.content ?? "";
    const extracted = extractStructuredOrderData(lastUser);
    return hasAllRequiredFields(extracted);
  };

  const isOrderClaimWithoutConfirmation = (replyText: string) => {
    const lower = String(replyText).toLowerCase();
    const patterns: RegExp[] = [
      /pedido[\s\S]{0,60}(registrad[oa]|guardad[oa]|confirmad[oa]|en proceso|procesad[oa]|fue registrado|fue guardado|ya est[aá] registrado|ya est[aá] en proceso)/i,
      /(registrad[oa]|guardad[oa]|confirmad[oa])[\s\S]{0,40}(su |tu |el )?pedido/i,
      /su pedido .* (registrad[oa]|guardad[oa]|confirmad[oa])/i,
      /pedido .* (es |est[aá] |ya )?(registrad[oa]|guardad[oa]|confirmad[oa])/i,
      /gracias por su compra/i,
      /muchas gracias por su compra/i,
      /pedido ha sido (registrad|guardad|confirmad)/i,
    ];
    return patterns.some((re) => re.test(lower));
  };

  const buildSafeReply = (replyText: string) => {
    if (isOrderClaimWithoutConfirmation(replyText) && !orderConfirmed) {
      return {
        reply: "Permítame un momento, estoy confirmando su pedido. Ya casi terminamos... 😊",
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

    const structured = extractStructuredOrderData(lastUser);

    return {
      Origen: "Recuperación automática: la IA confirmó el pedido sin ejecutar la herramienta confirm_order",
      "Confirmación cliente": lastUser,
      "Resumen mostrado al cliente": lastAssistant,
      "Respuesta de confirmación enviada": replyText,
      "Historial reciente": recent
        .map((m) => `${m.role === "assistant" ? "Asistente" : "Cliente"}: ${m.content.trim()}`)
        .join("\n"),
      "Registrado en": new Date().toISOString(),
      ...structured,
    } as Record<string, unknown>;
  };

  const isExplicitCustomerConfirmation = (text: string) => {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return false;
    const shortAffirmative = /^(s[ií]|si|ok|okay|dale|listo|claro|vale|perfecto|confirmo|confirmado|adelante|de acuerdo)([\s.!¡¿?]|$)/i;
    const explicitConfirmation = /\b(correcto|est[aá] bien|todo bien|confirmar|confirmado|confirmo|adelante|de acuerdo|registrad[oa]|guardad[oa]|guardarlo|guardar|pedido.*bien)\b/i;
    return shortAffirmative.test(normalized) || explicitConfirmation.test(normalized);
  };

  const shouldConfirmOrderFromHistory = () => {
    const visibleHistory = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
      .filter((m) => !m.content.trim().startsWith("[INSTRUCCIÓN DEL SISTEMA"));
    const lastUserIndex = visibleHistory.map((m) => m.role).lastIndexOf("user");
    if (lastUserIndex <= 0) return false;
    const lastUser = visibleHistory[lastUserIndex]?.content ?? "";
    const assistantHistory = [...visibleHistory.slice(0, lastUserIndex)].reverse();
    const recentAssistantPrompts = assistantHistory
      .filter((m) => m.role === "assistant")
      .slice(0, 4)
      .map((m) => m.content ?? "")
      .join(" \n");

    const confirmationPrompt = /\b(informaci[oó]n es correcta|confirmar (su |tu |el )?pedido|resumen|datos.*pedido|pedido.*correct[oa]|pedido.*bien|confirmar.*pedido|confirmaci[oó]n.*pedido|¿.*correct[oa].*pedido|¿.*informaci[oó]n.*correcta|¿.*quieres que registre|¿.*quieres que lo registre|registralo|reg[íi]stralo|guardalo|confirmalo)\b/i;
    const orderContextPrompt = /\b(pedido|resumen|confirmaci[oó]n|datos.*pedido|guardar|registrar|confirmar)\b/i;
    
    const isExplicitConf = isExplicitCustomerConfirmation(lastUser);
    const isDump = isCollectingOrder && isDataDump();

    return (isExplicitConf && (confirmationPrompt.test(recentAssistantPrompts) || orderContextPrompt.test(recentAssistantPrompts))) || isDump;
  };

  const markCollectingOrderDataIfNeeded = async (replyText: string) => {
    if (!orderFields.length || orderConfirmed || actions.includes("confirm_order")) return;
    if (!/(para agendar su pedido|para agendar tu pedido|ind[ií]queme|ind[ií]came|datos.*pedido|pedido.*datos)/i.test(replyText)) return;
    await (supabaseAdmin as any)
      .from("threads")
      .update({ purchase_intent: "collecting_data" })
      .eq("id", threadId)
      .eq("org_id", orgId);
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

  if (shouldConfirmOrderFromHistory()) {
    const exec = await executeToolCall(
      {
        id: `deterministic_confirm_${Date.now()}`,
        function: {
          name: "confirm_order",
          arguments: JSON.stringify({
            form_data: JSON.stringify(buildRecoveredOrderData("Confirmación explícita del cliente")),
          }),
        },
      },
      ctx
    );
    actions.push(exec.name);
    orderConfirmed = exec.result.toLowerCase().includes("pedido guardado exitosamente");
    if (orderConfirmed) {
      return { reply: "Pedido registrado correctamente. Gracias, su pedido está en proceso.", actions };
    }
  }

  // Loop de hasta 6 rondas para encadenar tool-calls: search_catalog → send_product → respuesta final
  // Aumentamos a 6 rondas para dar margen a encadenar múltiples llamadas a send_product_image.
  const notifyRetryMessage = async (attempt: number) => {
    if (!sessionId || !chatId) return;
    
    let message = '';
    if (attempt === 4) {
      // 4to intento después de 3 silenciosos
      message = 'Permíteme un minuto, ya te confirmo 😊';
    } else if (attempt === 7) {
      // 7mo intento, último esfuerzo
      message = 'Dame un ratito, ya te envío 😉';
    }
    
    if (message) {
      await supabaseAdmin.from('engine_commands').insert({
        org_id: orgId,
        session_id: sessionId,
        type: 'SEND_MESSAGE',
        payload: { chatId, text: message },
        status: 'pending',
      });
    }
  };

  for (let round = 0; round < 4; round++) {
    let result;
    try {
      result = await callAiProvider(cfg, msgs, tools, notifyRetryMessage);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn('[runAiAgent] round failed, attempting fallback or continuing', {
        round,
        error: errMsg,
        provider: cfg.selected_provider || cfg.provider,
        hasActions: actions.length > 0,
      });
      
      // Si es Vertex y hay proveedor alternativo, intentar fallback
      if ((cfg.selected_provider === 'vertex' || cfg.provider === 'vertex') &&
          (errMsg.includes('Vertex 429') ||
            errMsg.includes('Vertex 503') ||
            errMsg.includes('RESOURCE_EXHAUSTED') ||
            errMsg.includes('AbortError') ||
            errMsg.includes('timeout') ||
            errMsg.includes('aborted'))) {
        try {
          console.info('[runAiAgent] Vertex failed in loop, attempting fallback provider');
          result = await fallbackVertexProvider(cfg, msgs, tools);
        } catch (fallbackErr) {
          console.error('[runAiAgent] fallback also failed', fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
          // No break: permitir que el loop continúe en la siguiente ronda
          // Usar respuesta genérica para mantener conversación viva
          result = { text: '', toolCalls: undefined };
          continue;
        }
      } else {
        // Error que no es de Vertex o no hay fallback disponible
        throw err;
      }
    }

    if (!result) {
      console.warn('[runAiAgent] result is undefined after error handling, using safe fallback');
      result = { text: '', toolCalls: undefined };
    }

    const { text, toolCalls } = result;
    lastText = text || lastText;

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

      await markCollectingOrderDataIfNeeded(finalText);

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
      const signature = toolCallSignature(tc);
      let exec;
      if (executedToolCalls.has(signature)) {
        exec = {
          name: tc.function.name,
          result: `Herramienta ${tc.function.name} omitida porque ya se ejecutó con los mismos argumentos.`,
        };
      } else {
        executedToolCalls.add(signature);
        exec = await executeToolCall(tc, ctx);
      }
      actions.push(exec.name);
      if (exec.name === "confirm_order" && exec.result.toLowerCase().includes("pedido guardado exitosamente")) {
        orderConfirmed = true;
      }
      if (
        (exec.name === "send_product_image" || exec.name === "send_product_video") &&
        /enviado al cliente/i.test(exec.result)
      ) {
        deliveredProductMedia = true;
      }
      msgs.push({ role: "tool", tool_call_id: tc.id, name: exec.name, content: exec.result });

      // Si la herramienta fue `search_products` y devolvió una lista, el backend
      // envía las imágenes de forma determinística. No agregamos una nota para que
      // la IA repita send_product_image, porque eso causa duplicados/dedupe y deja
      // el flujo en estado inconsistente.
      if (exec.name === "search_products") {
        try {
          const parsed = JSON.parse(exec.result || "{}");
          const productsFromTool = parsed?.products ?? [];
          if (Array.isArray(productsFromTool) && productsFromTool.length > 0) {
            const topImages = productsFromTool.slice(0, 6).filter((p: any) => p?.id && p?.has_image !== false);
            for (const p of topImages) {
              const imageExec = await executeToolCall(
                {
                  id: `auto_img_${p.id}`,
                  function: {
                    name: "send_product_image",
                    arguments: JSON.stringify({
                      product_id: p.id,
                      caption: `${p.list_index ?? productsFromTool.indexOf(p) + 1}. ${p.name} — $${p.price ?? ""}`,
                    }),
                  },
                },
                ctx,
              );
              actions.push(imageExec.name);
              if (/enviado al cliente/i.test(imageExec.result)) {
                deliveredProductMedia = true;
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    if (deliveredProductMedia) {
      return { reply: buildProductMediaFollowUp(), actions };
    }
  }

  // Pasada final sin tools para forzar respuesta en texto después de 6 rondas
  let finalText: string;
  try {
    const result = await callAiProvider(cfg, msgs);
    finalText = result.text;
  } catch (err) {
    console.warn('[runAiAgent] final text generation failed after tool chain, falling back to last known text or image follow-up', {
      error: err instanceof Error ? err.message : String(err),
      orgId,
      threadId,
      actions,
    });
    if (lastText) {
      finalText = lastText;
    } else if (actions.some((a) => a === 'send_product_image' || a === 'send_product_video')) {
      finalText = '¿Cuál te gusta más? Cuéntame y avanzamos con tu pedido.';
    } else {
      throw err;
    }
  }

  await markCollectingOrderDataIfNeeded(finalText || lastText);
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
