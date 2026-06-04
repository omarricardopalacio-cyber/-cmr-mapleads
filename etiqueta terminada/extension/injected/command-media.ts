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

  const mimeType =
    (payload.mimeType as string) ||
    (payload.mime_type as string) ||
    "application/octet-stream";

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo descargar el archivo (${response.status})`);
  }

  const blob = await response.blob();
  const dataUri = await blobToDataUri(blob);
  return {
    dataUri,
    mimeType: blob.type || mimeType,
  };
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