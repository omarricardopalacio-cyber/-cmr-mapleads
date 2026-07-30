/** WhatsApp puts JPEG thumbnail base64 in msg.body for media messages. */

export function isBase64Thumbnail(text: string | null | undefined): boolean {
  if (!text || text.length < 100) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith("/9j/") || trimmed.startsWith("data:image")) return true;
  if (!trimmed.includes(" ") && trimmed.length > 150) return true;
  return false;
}

/** Banners / protocolo de WA Web que no son mensajes de cliente. */
export function isWhatsAppSystemText(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return false;
  const patterns = [
    /cifrados?\s+(de\s+extremo\s+a\s+extremo|extremo\s+a\s+extremo)/i,
    /end-to-end\s+encrypted/i,
    /mensajes?\s+y\s+llamadas?\s+(est[aá]n\s+)?cifrados/i,
    /solo\s+(t[uú]|las\s+personas)\s+(en\s+)?(este\s+)?chat\s+pueden\s+(leerlo|leerlos)/i,
    /waiting\s+for\s+this\s+message/i,
    /esperando\s+este\s+mensaje/i,
    /este\s+mensaje\s+se\s+elimin[oó]/i,
    /you\s+deleted\s+this\s+message/i,
    /eliminaste\s+este\s+mensaje/i,
    /messages?\s+(and\s+)?calls?\s+are\s+end-to-end\s+encrypted/i,
    /haz\s+clic\s+(para\s+)?obtener\s+m[aá]s\s+info/i,
    /tap\s+to\s+learn\s+more/i,
    /security\s+code\s+changed/i,
    /el\s+c[oó]digo\s+de\s+seguridad\s+cambi[oó]/i,
  ];
  return patterns.some((re) => re.test(t));
}

/** Quita basura de tool-calls que a veces el modelo pega como texto. */
export function stripLeakedToolMarkup(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .replace(/<\/?(?:function|tool_call|tool_response|invoke|parameter)[^>]*>/gi, "")
    .replace(/<(?:activate_flow|present_product|send_catalog)[^>]*>[\s\S]*?(?:<\/(?:activate_flow|present_product|send_catalog|function)>|$)/gi, "")
    .replace(/<\/?function>/gi, "")
    .replace(/\{\s*"flow_id"\s*:\s*"[^"]+"\s*,\s*"flow_name"\s*:\s*'[^']*'\s*\}/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeMessageText(
  text: string | null | undefined,
  caption?: string | null
): string | null {
  if (!text) return caption?.trim() || null;
  if (isBase64Thumbnail(text)) {
    return caption?.trim() || null;
  }
  if (isWhatsAppSystemText(text)) return null;
  return text;
}
