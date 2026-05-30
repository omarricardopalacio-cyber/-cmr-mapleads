import { SignJWT, importPKCS8 } from "jose";

type Msg = { role: "system" | "user" | "assistant"; content: string };

export async function callLovableAI(opts: {
  model: string;
  messages: Msg[];
}): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY no configurada");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    body: JSON.stringify({ model: opts.model, messages: opts.messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lovable AI ${res.status}: ${text.slice(0, 300)}`);
  }
  const j: any = await res.json();
  return j.choices?.[0]?.message?.content ?? "";
}

let cachedToken: { token: string; exp: number } | null = null;

async function getVertexAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp - 60 > Date.now() / 1000) return cachedToken.token;
  const raw = process.env.VERTEX_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("VERTEX_SERVICE_ACCOUNT_JSON no configurada");
  const sa = JSON.parse(raw);
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

export async function callVertexAI(opts: {
  project: string;
  location: string;
  model: string;
  messages: Msg[];
}): Promise<string> {
  const token = await getVertexAccessToken();
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
  return j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
}

export async function generateReply(
  cfg: {
    provider: "lovable" | "vertex";
    model: string;
    system_prompt: string;
    knowledge_base: string;
    vertex_project?: string | null;
    vertex_location?: string | null;
    vertex_model?: string | null;
  },
  userText: string,
  history: Msg[] = [],
): Promise<string> {
  const system = [
    cfg.system_prompt?.trim() || "Eres un asistente útil.",
    cfg.knowledge_base?.trim()
      ? `\n\n=== BASE DE CONOCIMIENTO / PRODUCTOS ===\n${cfg.knowledge_base.trim()}`
      : "",
  ].join("");
  const messages: Msg[] = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userText },
  ];

  if (cfg.provider === "vertex") {
    if (!cfg.vertex_project) throw new Error("Falta vertex_project");
    return callVertexAI({
      project: cfg.vertex_project,
      location: cfg.vertex_location || "us-central1",
      model: cfg.vertex_model || "gemini-2.5-flash",
      messages,
    });
  }
  return callLovableAI({ model: cfg.model || "google/gemini-2.5-flash", messages });
}
