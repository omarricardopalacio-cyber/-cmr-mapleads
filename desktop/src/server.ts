import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { PilotDatabase } from "./database.js";
import type { JsonRecord } from "./types.js";

const HOST = "127.0.0.1";
export const DEFAULT_PORT = 4317;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export function startPilotServer(database: PilotDatabase, mediaDirectory: string, port = DEFAULT_PORT): Promise<Server> {
  const token = database.getOrCreateToken();
  const server = createServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      const cors = corsHeaders(origin);
      if (request.method === "OPTIONS") return respond(response, 204, null, cors);
      if (!isAllowedOrigin(origin)) return respond(response, 403, { error: "Origin not allowed" }, cors);
      if (request.url === "/health" && request.method === "GET") {
        return respond(response, 200, { ok: true, service: "maple-local-pilot" }, cors);
      }
      if (!authenticated(request, token)) return respond(response, 401, { error: "Invalid session token" }, cors);
      if (request.url === "/api/local/messages" && request.method === "GET") {
        return respond(response, 200, { messages: database.recentMessages() }, cors);
      }

      if (request.url === "/api/public/engine/commands" && request.method === "GET") {
        return respond(response, 200, { commands: database.claimCommands(), serverTime: new Date().toISOString() }, cors);
      }

      const body = await readJson(request);
      if (request.url === "/api/public/engine/ingest" && request.method === "POST") {
        return respond(response, 200, { ok: true, ...database.ingest(body) }, cors);
      }
      if (request.url === "/api/public/engine/heartbeat" && request.method === "POST") {
        database.recordHeartbeat(body);
        return respond(response, 200, { ok: true }, cors);
      }
      if (request.url === "/api/public/engine/import-history" && request.method === "POST") {
        const events = Array.isArray(body.events) ? body.events : historyEvents(body);
        return respond(response, 200, { ok: true, importMode: "minimal", ...database.ingest({ ...body, events }) }, cors);
      }
      if (request.url === "/api/public/engine/upload-media" && request.method === "POST") {
        const uploaded = await storeMedia(body, mediaDirectory);
        return respond(response, 200, { ok: true, ...uploaded }, cors);
      }
      return respond(response, 404, { error: "Not found" }, cors);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      const status = /body|JSON|base64|media/i.test(message) ? 400 : 500;
      return respond(response, status, { error: message }, corsHeaders(request.headers.origin));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function authenticated(request: IncomingMessage, token: string): boolean {
  const candidate = request.headers["x-session-token"];
  if (typeof candidate !== "string") return false;
  const left = createHash("sha256").update(candidate).digest();
  const right = createHash("sha256").update(token).digest();
  return timingSafeEqual(left, right);
}

function isAllowedOrigin(origin: string | undefined): boolean {
  return !origin || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}
function corsHeaders(origin: string | undefined): Record<string, string> {
  return isAllowedOrigin(origin) && origin ? {
    "Access-Control-Allow-Origin": origin, "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Token",
  } : {};
}
function respond(response: ServerResponse, status: number, body: unknown, headers: Record<string, string>) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(body === null ? undefined : JSON.stringify(body));
}
function readJson(request: IncomingMessage): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    let content = "";
    let settled = false;
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      if (settled) return;
      content += chunk;
      if (Buffer.byteLength(content) > MAX_BODY_BYTES) {
        settled = true;
        content = "";
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try { resolve(content ? JSON.parse(content) as JsonRecord : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}
async function storeMedia(body: JsonRecord, mediaDirectory: string) {
  const data = typeof body.data === "string" ? body.data : "";
  const match = data.match(/^(?:data:[^;]+;base64,)?([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error("Invalid base64 media payload");
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length) throw new Error("Empty media payload");
  const requested = typeof body.fileName === "string" ? basename(body.fileName) : "upload.bin";
  const fileName = `${Date.now()}-${requested.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await mkdir(mediaDirectory, { recursive: true });
  await writeFile(join(mediaDirectory, fileName), buffer);
  return { storagePath: fileName, url: `local-media://${fileName}`, mimeType: body.mimeType ?? "application/octet-stream", size: buffer.length };
}
function historyEvents(body: JsonRecord) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.map((message, index) => {
    const item = message && typeof message === "object" ? message as JsonRecord : {};
    return {
      id: `history:${String(item.waMessageId ?? index)}`,
      type: item.fromMe ? "MESSAGE_SENT" : "NEW_MESSAGE",
      timestamp: item.sentAt ?? item.timestamp ?? Date.now(),
      payload: {
        ...item, messageId: item.waMessageId, chatId: body.chatId,
        body: item.text ?? item.body, from: item.from ?? body.contact,
        to: item.to, displayName: isRecord(body.contact) ? body.contact.displayName : undefined,
      },
    };
  });
}
function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
