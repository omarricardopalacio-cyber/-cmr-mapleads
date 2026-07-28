/** Helpers de media para tienda (catálogo + chat). */

export function youtubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace("/", "").split("/")[0];
      return id ? `https://www.youtube.com/embed/${id}?playsinline=1&autoplay=1&mute=1` : null;
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v") || u.pathname.match(/\/(?:embed|shorts)\/([^/]+)/)?.[1];
      return id ? `https://www.youtube.com/embed/${id}?playsinline=1&autoplay=1&mute=1` : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function vimeoEmbedUrl(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  return m ? `https://player.vimeo.com/video/${m[1]}?autoplay=1&muted=1` : null;
}

/** Google Drive → iframe preview (reproduce en el mismo lugar). */
export function driveEmbedUrl(url: string): string | null {
  const m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/i);
  if (m?.[1]) return `https://drive.google.com/file/d/${m[1]}/preview`;
  return null;
}

/** URL reproducible en <video src> (no YouTube/Drive/páginas). */
export function isDirectPlayableVideo(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (youtubeEmbedUrl(u) || vimeoEmbedUrl(u) || driveEmbedUrl(u)) return false;
  if (/dropbox\.com\/s\/|facebook\.com|tiktok\.com|instagram\.com/i.test(u)) return false;
  if (/\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i.test(u)) return true;
  if (/supabase\.co\/storage|cloudinary|mux\.com|videodelivery|cdn\.|blob\.core|amazonaws\.com/i.test(u)) {
    return true;
  }
  if (!/\.(jpe?g|png|gif|webp|svg|pdf|html?)(\?|#|$)/i.test(u)) return true;
  return false;
}

export type StoreMediaMode =
  | { kind: "youtube"; embed: string }
  | { kind: "vimeo"; embed: string }
  | { kind: "drive"; embed: string }
  | { kind: "video"; src: string }
  | { kind: "image"; src: string }
  | { kind: "none" };

/** Prioriza video embebible/directo; si no, imagen. */
export function resolveStoreMedia(
  videoUrl: string | null | undefined,
  imageUrl: string | null | undefined,
): StoreMediaMode {
  const v = videoUrl?.trim() || "";
  const img = imageUrl?.trim() || "";
  if (v) {
    const yt = youtubeEmbedUrl(v);
    if (yt) return { kind: "youtube", embed: yt };
    const vim = vimeoEmbedUrl(v);
    if (vim) return { kind: "vimeo", embed: vim };
    const drive = driveEmbedUrl(v);
    if (drive) return { kind: "drive", embed: drive };
    // Intentar siempre <video> si parece URL de archivo/CDN
    if (isDirectPlayableVideo(v) || /^https?:\/\//i.test(v)) {
      return { kind: "video", src: v };
    }
  }
  if (img) return { kind: "image", src: img };
  return { kind: "none" };
}
