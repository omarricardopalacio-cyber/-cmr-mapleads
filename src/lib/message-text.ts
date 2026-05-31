/** WhatsApp puts JPEG thumbnail base64 in msg.body for media messages. */

export function isBase64Thumbnail(text: string | null | undefined): boolean {
  if (!text || text.length < 100) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith("/9j/") || trimmed.startsWith("data:image")) return true;
  if (!trimmed.includes(" ") && trimmed.length > 150) return true;
  return false;
}

export function sanitizeMessageText(
  text: string | null | undefined,
  caption?: string | null
): string | null {
  if (!text) return caption?.trim() || null;
  if (isBase64Thumbnail(text)) {
    return caption?.trim() || null;
  }
  return text;
}
