// Validate URL before fetching to prevent SSRF attacks.
// Only https:// is allowed, and the host must not resolve to a private/loopback/link-local IP range.
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "ip6-localhost" || h === "ip6-loopback") return true;
  // IPv4 literal check
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  // IPv6 — block loopback, link-local, ULA
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
    if (h.startsWith("::ffff:")) return isPrivateHost(h.replace("::ffff:", ""));
    return false;
  }
  return false;
}

function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid media URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Only https:// media URLs are allowed");
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error("Media URL host is not allowed");
  }
  return url;
}

const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25MB cap

/** Path inside bucket `media` from a Supabase public/signed object URL. */
export function storagePathFromMediaUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/media\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export async function convertUrlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const safe = assertSafeUrl(url);
  const response = await fetch(safe.toString(), { redirect: "follow" });
  if (!response.ok) throw new Error(`Failed to fetch media: ${response.status}`);
  const lenHeader = response.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > MAX_MEDIA_BYTES) {
    throw new Error("Media too large");
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_MEDIA_BYTES) {
    throw new Error("Media too large");
  }
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = response.headers.get("content-type") || "application/octet-stream";
  return { base64, mimeType };
}
