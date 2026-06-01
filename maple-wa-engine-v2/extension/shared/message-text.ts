// Filters WhatsApp JPEG thumbnail base64 accidentally exposed as message body.

export function isBase64Thumbnail(text: string | null | undefined): boolean {
  if (!text || text.length < 100) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith("/9j/") || trimmed.startsWith("data:image")) return true;
  if (!trimmed.includes(" ") && trimmed.length > 150) return true;
  return false;
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

  return cleanBody;
}