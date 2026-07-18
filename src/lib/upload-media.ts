import { supabase } from "@/integrations/supabase/client";

/**
 * Sube un archivo al bucket "media" y devuelve una URL firmada de larga duración
 * más el mime_type. Usado por Respuestas Rápidas y Campañas Masivas.
 */
export async function uploadMedia(file: File): Promise<{ url: string; mime_type: string; path: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? "anon";
  const ext = file.name.split(".").pop() || "bin";
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("media")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw new Error(`upload: ${upErr.message}`);
  // URL firmada por 10 años (bucket privado)
  const { data: signed, error: signErr } = await supabase.storage
    .from("media")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (signErr || !signed) throw new Error(`signed url: ${signErr?.message}`);
  return { url: signed.signedUrl, mime_type: file.type, path };
}

export function mediaKindFromMime(mime: string): "image" | "video" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}
