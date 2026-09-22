// Filters WhatsApp JPEG thumbnail base64 accidentally exposed as message body.

export function isBase64Thumbnail(text: string | null | undefined): boolean {
  if (!text || text.length < 100) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith("/9j/") || trimmed.startsWith("data:image")) return true;
  // Solo alfabeto base64. Un cuerpo de emojis (aunque sea largo y sin espacios)
  // no es un thumbnail JPEG.
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length > 150 && /^[A-Za-z0-9+/=]+$/.test(compact)) return true;
  return false;
}

/** Texto que el CRM puede guardar. Un cuerpo de solo emojis cuenta. */
export function hasVisibleMessageText(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isBase64Thumbnail(trimmed)) return false;
  if (isWhatsAppSystemText(trimmed)) return false;
  return true;
}

/**
 * WhatsApp pinta los emojis como `<img alt>` y deja `innerText` vacío.
 * Si el texto visible no trae esos alt, se anexan.
 */
export function visibleTextFromParts(parts: {
  innerText?: string | null;
  alts?: Array<string | null | undefined>;
  plain?: Array<string | null | undefined>;
}): string {
  const inner = String(parts.innerText || "").trim();
  const extras = [...(parts.plain || []), ...(parts.alts || [])]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (hasVisibleMessageText(inner)) {
    const missing = extras.filter((extra) => !inner.includes(extra));
    return missing.length ? `${inner} ${missing.join(" ")}`.trim() : inner;
  }
  const fromExtras = extras.join(" ").trim();
  if (hasVisibleMessageText(fromExtras)) return fromExtras;
  return "";
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