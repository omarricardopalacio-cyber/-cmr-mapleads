// Lectura de respuestas del CRM. Un HTML 200 (la SPA) no es JSON de comandos.

export const MEDIA_UNAVAILABLE_LABEL = "Multimedia no disponible";

export function looksLikeHtml(body: string, contentType?: string | null): boolean {
  const type = (contentType || "").toLowerCase();
  if (type.includes("text/html") || type.includes("application/xhtml")) return true;
  const start = body.trimStart().slice(0, 64).toLowerCase();
  return start.startsWith("<!doctype") || start.startsWith("<html") || start.startsWith("<head");
}

/** Mensaje de depuración: ruta concreta, nunca el «Failed to fetch» pelado del navegador. */
export function describeTransportError(url: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "");
  const generic = /failed to fetch|networkerror|load failed/i.test(raw);
  if (generic || !raw) {
    return `No se pudo contactar ${url}. El CRM no devolvió JSON.`;
  }
  if (raw.includes(url)) return raw;
  return `${raw} (${url})`;
}

export function commandsRoutingError(url: string): string {
  return `La ruta de comandos respondió HTML, no JSON: ${url}`;
}

export type CommandsRead =
  | { ok: true; commands: unknown[] }
  | { ok: false; message: string };

export function interpretCommandsResponse(input: {
  url: string;
  status: number;
  ok: boolean;
  contentType?: string | null;
  body: string;
}): CommandsRead {
  const { url, status, body } = input;
  if (!input.ok) {
    return { ok: false, message: `No se pudo leer comandos (HTTP ${status}) en ${url}` };
  }
  if (looksLikeHtml(body, input.contentType)) {
    return { ok: false, message: commandsRoutingError(url) };
  }
  let parsed: unknown;
  try {
    parsed = body.trim() ? JSON.parse(body) : {};
  } catch {
    return { ok: false, message: commandsRoutingError(url) };
  }
  if (Array.isArray(parsed)) return { ok: true, commands: parsed };
  if (parsed && typeof parsed === "object") {
    const commands = (parsed as { commands?: unknown }).commands;
    if (Array.isArray(commands)) return { ok: true, commands };
    if (commands == null) return { ok: true, commands: [] };
  }
  return { ok: false, message: commandsRoutingError(url) };
}

/** Ficha de ingest cuando WhatsApp no entrega los bytes (rar/zip en otro dispositivo). */
export function unavailableMedia<T extends Record<string, unknown>>(media?: T | null): T & {
  missing_media: true;
  label: string;
  extraction_error: string;
} {
  return {
    ...(media || ({} as T)),
    missing_media: true,
    label: MEDIA_UNAVAILABLE_LABEL,
    extraction_error: "unavailable_on_device",
  };
}
