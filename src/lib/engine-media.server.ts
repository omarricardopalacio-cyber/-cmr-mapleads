import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const STRIP_FIELD_MIN_LEN = 2048;

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
  "application/octet-stream": "bin",
};

export function normalizeMimeType(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

export function extensionFromMime(mimeType: string, msgType?: string): string {
  const normalized = normalizeMimeType(mimeType);
  const mapped = MIME_TO_EXTENSION[normalized];
  if (mapped) return mapped;
  if (msgType === "ptt" || msgType === "audio") return "ogg";
  if (msgType === "image") return "jpg";
  if (msgType === "video") return "mp4";
  if (msgType === "document") return "pdf";
  return "bin";
}

export function parseBase64Media(
  base64Raw: string,
  fallbackMime: string
): { mimeType: string; base64String: string } {
  let base64String = base64Raw.trim();
  let mimeType = normalizeMimeType(fallbackMime || "application/octet-stream");
  const dataUriMatch = base64String.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUriMatch) {
    const dataUriMime = normalizeMimeType(dataUriMatch[1]);
    // Solo usar el mime del data URI si es específico.
    // Si es genérico (application/octet-stream), respetar el fallback explícito.
    if (dataUriMime && dataUriMime !== "application/octet-stream") {
      mimeType = dataUriMime;
    }
    base64String = dataUriMatch[2];
  }
  base64String = base64String.replace(/\s/g, "");
  return { mimeType, base64String };
}

const HEAVY_KEYS = new Set(["base64", "body", "data"]);

export function stripHeavyFieldsForDb<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") {
    return (value.length > STRIP_FIELD_MIN_LEN
      ? `[stripped:${value.length}]`
      : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripHeavyFieldsForDb(item)) as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (HEAVY_KEYS.has(key) && typeof val === "string" && val.length > STRIP_FIELD_MIN_LEN) {
        out[key] = `[stripped:${val.length}]`;
        continue;
      }
      out[key] = stripHeavyFieldsForDb(val);
    }
    return out as T;
  }
  return value;
}

export async function uploadBase64ToStorage(
  base64Raw: string,
  orgId: string,
  options?: { mimeType?: string; msgType?: string; fileName?: string }
): Promise<{
  url: string;
  storagePath: string;
  mimeType: string;
  mime_type: string;
  filename: string;
  size: number;
} | null> {
  const rawMime = options?.mimeType || "application/octet-stream";
  const { mimeType, base64String } = parseBase64Media(base64Raw, rawMime);

  console.log("[uploadBase64ToStorage] rawMime:", rawMime, "parsed mimeType:", mimeType);
  console.log("[uploadBase64ToStorage] base64String length:", base64String?.length);
  console.log("[uploadBase64ToStorage] base64String first 50 chars:", base64String?.slice(0, 50));

  if (!base64String) return null;

  const bytes = Buffer.from(base64String, "base64");
  console.log("[uploadBase64ToStorage] Buffer length:", bytes.length);
  console.log("[uploadBase64ToStorage] Buffer first 8 bytes:", bytes.slice(0, 8).toString("hex"));

  if (!bytes.length) return null;
  if (bytes.length > MAX_MEDIA_BYTES) {
    throw new Error(`Media exceeds ${MAX_MEDIA_BYTES} bytes`);
  }

  const ext = extensionFromMime(mimeType, options?.msgType);
  const fileName =
    options?.fileName || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const pathKey = `${orgId}/${fileName}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from("media")
    .upload(pathKey, bytes, { contentType: mimeType, upsert: false });
  if (upErr) throw new Error(upErr.message);

  console.log("[uploadBase64ToStorage] Upload success:", pathKey, "size:", bytes.length);

  const { data: urlData } = supabaseAdmin.storage.from("media").getPublicUrl(pathKey);
  return {
    url: urlData.publicUrl,
    storagePath: pathKey,
    mimeType,
    mime_type: mimeType,
    filename: fileName,
    size: bytes.length,
  };
}

export async function enrichMediaForMessage(
  media: Record<string, unknown> | null | undefined,
  orgId: string
): Promise<Record<string, unknown> | null> {
  if (!media) return null;

  const existingUrl = (media.url || media.mediaUrl || media.fileUrl) as string | undefined;
  if (existingUrl && existingUrl.startsWith("http") && !existingUrl.startsWith("blob:")) {
    const rawMime = (media.mimetype || media.mimeType || media.mime_type || "") as string;
    let normalizedMime = rawMime ? normalizeMimeType(rawMime) : "application/octet-stream";

    // Si el mime sigue siendo genérico, inferir por tipo de mensaje o extensión de URL
    if (normalizedMime === "application/octet-stream") {
      const msgType = media.type as string;
      if (msgType === "image") normalizedMime = "image/jpeg";
      else if (msgType === "video") normalizedMime = "video/mp4";
      else if (msgType === "ptt" || msgType === "audio") normalizedMime = "audio/ogg";
      else if (msgType === "document") normalizedMime = "application/pdf";
    }

    return {
      url: existingUrl,
      mimeType: normalizedMime,
      mime_type: normalizedMime,
      caption: (media.caption as string) || undefined,
      filename: (media.filename || media.fileName) as string | undefined,
      storagePath: media.storagePath as string | undefined,
    };
  }

  const base64Raw = (media.base64 || media.body || media.data) as string | undefined;
  console.log("[engine-media] enrichMediaForMessage input:", {
    hasBase64: !!media.base64,
    base64Len: (media.base64 as string)?.length || 0,
    hasBody: !!media.body,
    bodyLen: (media.body as string)?.length || 0,
    hasData: !!media.data,
    dataLen: (media.data as string)?.length || 0,
    mimetype: media.mimetype,
    type: media.type,
    base64RawFound: !!base64Raw,
    base64RawLen: base64Raw?.length || 0,
    base64RawPrefix: base64Raw?.substring(0, 30) || null,
  });
  if (!base64Raw) {
    console.log("[engine-media] No base64Raw found, returning missing_media");
    return { ...media, url: null, missing_media: true };
  }

  try {
    const msgType = typeof media.type === "string" ? media.type : undefined;
    const uploaded = await uploadBase64ToStorage(base64Raw, orgId, {
      mimeType: (media.mimetype || media.mimeType || media.mime_type) as string,
      msgType,
      fileName: (media.filename || media.fileName) as string | undefined,
    });
    if (!uploaded) {
      console.log("[engine-media] uploadBase64ToStorage returned null");
      return { ...media, url: null, error: "Archivo vacio o corrupto" };
    }
    console.log("[engine-media] Upload success:", uploaded.url);
    return {
      url: uploaded.url,
      mimeType: uploaded.mimeType,
      mime_type: uploaded.mime_type,
      caption: (media.caption as string) || undefined,
      filename: uploaded.filename,
      storagePath: uploaded.storagePath,
      size: uploaded.size,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[engine-media] upload error:", message);
    return { ...media, url: null, error: message };
  }
}