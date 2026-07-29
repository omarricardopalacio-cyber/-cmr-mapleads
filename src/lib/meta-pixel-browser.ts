/** Helpers Meta Pixel / GA (navegador) para la tienda pública. No-op en SSR. */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

export function ensureMetaPixel(pixelId: string): void {
  if (typeof window === "undefined" || !pixelId) return;
  if (window.fbq) {
    try {
      window.fbq("init", pixelId);
    } catch {
      /* already inited */
    }
    return;
  }

  const f = window as Window;
  const n = (function (...args: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = (n as any).callMethod
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (n as any).callMethod.apply(n, args)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (n as any).queue.push(args);
    return q;
  }) as Window["fbq"] & {
    queue: unknown[];
    loaded?: boolean;
    version?: string;
    callMethod?: (...a: unknown[]) => void;
  };

  if (!f.fbq) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n as any).queue = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n as any).loaded = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n as any).version = "2.0";
    f.fbq = n as Window["fbq"];
    f._fbq = n;
  }

  if (!document.getElementById("meta-pixel-script")) {
    const s = document.createElement("script");
    s.id = "meta-pixel-script";
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
  }

  window.fbq?.("init", pixelId);
}

export function trackMetaEvent(
  eventName: string,
  params?: Record<string, unknown>,
  eventId?: string,
): void {
  if (typeof window === "undefined" || !window.fbq) return;
  try {
    if (eventId) {
      window.fbq("track", eventName, params || {}, { eventID: eventId });
    } else {
      window.fbq("track", eventName, params || {});
    }
  } catch {
    /* ignore */
  }
}

export function ensureGoogleAnalytics(measurementId: string): void {
  if (typeof window === "undefined" || !measurementId) return;
  if (document.getElementById("ga-gtag")) return;
  const s = document.createElement("script");
  s.id = "ga-gtag";
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(s);
  const inline = document.createElement("script");
  inline.id = "ga-gtag-inline";
  inline.text = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${measurementId.replace(/'/g, "")}');
  `;
  document.head.appendChild(inline);
}
