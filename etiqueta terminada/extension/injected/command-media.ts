/** Resuelve media de un comando CRM (URL en Storage) a data URI para WPP. */

export async function resolveCommandMedia(payload: Record<string, unknown>): Promise<{
  dataUri?: string;
  mimeType?: string;
}> {
  const inline = payload.media;
  if (typeof inline === "string" && inline.length > 0) {
    const mimeType =
      (payload.mimeType as string) ||
      (payload.mime_type as string) ||
      guessMimeFromDataUri(inline);
    return { dataUri: inline, mimeType };
  }

  const url = (payload.mediaUrl || payload.media_url) as string | undefined;
  if (!url || !url.startsWith("http")) {
    return {};
  }

  // Si la URL ya es pública, no hacemos fetch en el navegador para evitar retrasos y errores CORS.
  // Dejar que el engine de WhatsApp la envíe directamente como URL cuando sea posible.
  return {};
}

function guessMimeFromDataUri(dataUri: string): string {
  const match = dataUri.match(/^data:([^;]+);/i);
  return match ? match[1] : "application/octet-stream";
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}