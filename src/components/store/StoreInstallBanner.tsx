import { useEffect, useState } from "react";
import { Download, Bell, X, Share } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-expect-error iOS Safari
    !!navigator.standalone
  );
}

/**
 * Banner para instalar el acceso directo PWA + activar notificaciones.
 */
export function StoreInstallBanner({
  brandName,
  onEnablePush,
  pushEnabled,
}: {
  brandName: string;
  onEnablePush?: () => Promise<boolean> | boolean;
  pushEnabled?: boolean;
}) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone());
    const key = `maple_store_install_dismiss_${brandName}`;
    if (localStorage.getItem(key) === "1") setHidden(true);

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, [brandName]);

  if (hidden || standalone) return null;

  async function install() {
    if (isIos()) {
      setIosHint(true);
      return;
    }
    if (!deferred) {
      setIosHint(true);
      return;
    }
    setBusy(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
    } finally {
      setBusy(false);
    }
  }

  async function enableNotifs() {
    if (!onEnablePush) return;
    setBusy(true);
    try {
      await onEnablePush();
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    localStorage.setItem(`maple_store_install_dismiss_${brandName}`, "1");
    setHidden(true);
  }

  return (
    <div className="fixed bottom-20 left-3 right-3 z-50 mx-auto max-w-lg">
      <div className="rounded-2xl border border-white/10 bg-[#0b101a]/95 p-3.5 text-white shadow-2xl backdrop-blur">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
            <Download className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Acceso rápido en tu celular</p>
            <p className="mt-0.5 text-[12px] leading-snug text-white/65">
              Guarda {brandName} como icono y recibe avisos cuando te respondamos (número en el icono).
            </p>
            {iosHint ? (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-white/5 px-2 py-1.5 text-[11px] text-emerald-100/90">
                <Share className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                En iPhone: toca Compartir → <strong>Añadir a pantalla de inicio</strong>
              </p>
            ) : null}
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={install}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" />
                Guardar acceso
              </button>
              {onEnablePush && !pushEnabled ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={enableNotifs}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  <Bell className="h-3.5 w-3.5" />
                  Activar avisos
                </button>
              ) : null}
              {pushEnabled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-medium text-emerald-300">
                  <Bell className="h-3 w-3" /> Avisos activos
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export async function registerStoreServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/store-sw.js", { scope: "/" });
    return reg;
  } catch (err) {
    console.warn("[store-sw] register failed", err);
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enableStorePush(opts: {
  storeToken: string;
  visitorToken: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, error: "Este navegador no soporta notificaciones push" };
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, error: "Permiso de notificaciones denegado" };

  const vapidRes = await fetch("/api/public/store/push?action=vapid");
  const vapid = await vapidRes.json().catch(() => ({}));
  if (!vapid?.publicKey) {
    return { ok: false, error: "Push no configurado en el servidor" };
  }

  const reg = (await navigator.serviceWorker.getRegistration("/")) || (await registerStoreServiceWorker());
  if (!reg) return { ok: false, error: "No se pudo registrar el service worker" };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
    });
  }

  const json = sub.toJSON();
  const res = await fetch("/api/public/store/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Store-Token": opts.storeToken,
      "X-Visitor-Token": opts.visitorToken,
    },
    body: JSON.stringify({
      action: "subscribe",
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error || "No se pudo guardar la suscripción" };
  }
  return { ok: true };
}

export async function clearStoreBadgeAndMarkRead(opts: {
  storeToken: string;
  visitorToken: string;
}) {
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "CLEAR_BADGE" });
    }
    if (typeof navigator.clearAppBadge === "function") {
      await navigator.clearAppBadge().catch(() => {});
    }
    await fetch("/api/public/store/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Store-Token": opts.storeToken,
        "X-Visitor-Token": opts.visitorToken,
      },
      body: JSON.stringify({ action: "read" }),
    });
  } catch {
    /* ignore */
  }
}
