import { useEffect, useState } from "react";

/** Live CRM. Engine routes are under this prefix, not the site root. */
export const PRODUCTION_BACKEND_URL = "https://creadorpaginasmapleads.netlify.app/crm";

const CRM_MOUNT = "/crm";

/**
 * Base URL to paste into the extension. When this app is served at /crm,
 * `window.location.origin` omits that prefix and `/api/public/*` 404s.
 */
export function extensionBackendUrl(): string {
  if (typeof window === "undefined") return PRODUCTION_BACKEND_URL;
  const { origin, pathname } = window.location;
  if (pathname === CRM_MOUNT || pathname.startsWith(`${CRM_MOUNT}/`)) {
    return `${origin}${CRM_MOUNT}`;
  }
  return origin;
}

/** SSR-safe. First paint uses the production base; the effect matches the current host. */
export function useExtensionBackendUrl(): string {
  const [url, setUrl] = useState(PRODUCTION_BACKEND_URL);
  useEffect(() => {
    setUrl(extensionBackendUrl());
  }, []);
  return url;
}
