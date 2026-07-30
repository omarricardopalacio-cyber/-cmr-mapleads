// Filters WhatsApp JPEG thumbnail base64 accidentally exposed as message body.

export function isBase64Thumbnail(text: string | null | undefined): boolean {
  if (!text || text.length < 100) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith("/9j/") || trimmed.startsWith("data:image")) return true;
  if (!trimmed.includes(" ") && trimmed.length > 150) return true;
  return false;
}

export function isWhatsAppSystemText(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return false;
  return (
    /cifrados?\s+(de\s+extremo\s+a\s+extremo|extremo\s+a\s+extremo)/i.test(t) ||
    /end-to-end\s+encrypted/i.test(t) ||
    /mensajes?\s+y\s+llamadas?\s+(est[aá]n\s+)?cifrados/i.test(t) ||
    /solo\s+(t[uú]|las\s+personas)\s+(en\s+)?(este\s+)?chat\s+pueden\s+(leerlo|leerlos)/i.test(t) ||
    /waiting\s+for\s+this\s+message/i.test(t) ||
    /este\s+mensaje\s+se\s+elimin[oó]/i.test(t) ||
    /eliminaste\s+este\s+mensaje/i.test(t) ||
    /haz\s+clic\s+(para\s+)?obtener\s+m[aá]s\s+info/i.test(t) ||
    /tap\s+to\s+learn\s+more/i.test(t)
  );
}

export function sanitizeMessageBody(options: {
  body?: string | null;
  caption?: string | null;
  isMedia?: boolean;
  type?: string;
}): string {
  const isMediaType =
    options.isMedia ||
    ["image", "video", "audio", "ptt", "document", "sticker"].includes(options.type || "");

  let cleanBody = options.body || "";
  if (!cleanBody && isMediaType) {
    cleanBody = options.caption || "";
  }

  if (isMediaType && isBase64Thumbnail(cleanBody)) {
    return options.caption || "";
  }

  if (isBase64Thumbnail(cleanBody)) {
    return "";
  }

  if (isWhatsAppSystemText(cleanBody)) {
    return "";
  }

  return cleanBody;
}