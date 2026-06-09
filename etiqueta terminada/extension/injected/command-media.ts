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

    console.log("[command-media] resolving inline media", {
      hasDataUri: inline.startsWith("data:"),
      isPlainBase64: isPlainBase64String(inline),
      isHttpUrl: inline.startsWith("http"),
      mimeType,
      prefix: inline.substring(0, 80),
    });

    if (inline.startsWith("data:")) {
      const lowerMime = mimeType?.toLowerCase() || "";
      if (lowerMime.includes("html") || lowerMime.includes("text/")) {
        console.warn("[command-media] Rejecting inline text/html data URI as invalid media", { mimeType, prefix: inline.substring(0, 80) });
        return {};
      }
      return { dataUri: inline, mimeType };
    }

    if (isPlainBase64String(inline)) {
      return { dataUri: `data:${mimeType};base64,${inline}`, mimeType };
    }

    if (inline.startsWith("http")) {
      try {
        const response = await fetch(inline);
        if (!response.ok) {
          console.warn("[command-media] media URL fetch failed:", response.status, inline);
          return {};
        }
        const resolvedMime = response.headers.get("content-type") || mimeType;
        if (resolvedMime?.startsWith("text/") || resolvedMime?.includes("html")) {
          console.warn("[command-media] Rejecting URL with non-media content-type", { resolvedMime, url: inline });
          return {};
        }
        const blob = await response.blob();
        const dataUri = await blobToDataUri(blob);
        console.log("[command-media] fetched inline media URL successfully", { url: inline, resolvedMime });
        return { dataUri, mimeType: resolvedMime };
      } catch (err: any) {
        console.warn("[command-media] Error fetching direct media URL:", err?.message || err, inline);
        return {};
      }
    }

    return { dataUri: inline, mimeType };
  }

  const base64 = payload.base64 as string | undefined;
  if (typeof base64 === "string" && base64.length > 0) {
    const mimeType =
      (payload.mimeType as string) ||
      (payload.mime_type as string) ||
      "application/octet-stream";
    const dataUri = base64.startsWith("data:") ? base64 : `data:${mimeType};base64,${base64}`;
    return { dataUri, mimeType };
  }

  const url = (payload.mediaUrl || payload.media_url) as string | undefined;
  if (url && url.startsWith("http")) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn("[command-media] URL fetch failed:", response.status, url);
        return {};
      }
      const blob = await response.blob();
      const dataUri = await blobToDataUri(blob);
      const mimeType = String(
        response.headers.get("content-type") ||
        (payload.mimeType as string | undefined) ||
        (payload.mime_type as string | undefined) ||
        guessMimeFromDataUri(dataUri)
      );
      return { dataUri, mimeType };
    } catch (err: any) {
      console.warn("[command-media] Error fetching media URL:", err?.message || err, url);
      return {};
    }
  }

  return {};
}

function isPlainBase64String(value: string): boolean {
  if (!value || value.length < 100) return false;
  if (value.startsWith("http://") || value.startsWith("https://")) return false;
  const clean = value.replace(/\s+/g, "");
  if (clean.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(clean);
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