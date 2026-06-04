// ============================================================
// MAPLE WA ENGINE — WPP Bootstrap (Injected Script)
// Espera que window.WPP esté disponible con retry seguro
// ============================================================

interface WPPGlobal {
  whatsapp: any;
  chat: any;
  contact: any;
  conn: any;
  labels: any;
  on: (event: string, callback: (...args: any[]) => void) => void;
  prependListener: (
    event: string,
    callback: (...args: any[]) => void,
    options?: { objectify?: boolean }
  ) => void;
  off: (event: string, callback: (...args: any[]) => void) => void;
  loader: {
    onFullReady: (callback: () => void) => void;
  };
}

declare global {
  interface Window {
    WPP?: WPPGlobal;
  }
}

const WPP_WAIT_TIMEOUT = 30000;
const WPP_RETRY_INTERVAL = 100;

export async function waitForWPP(): Promise<WPPGlobal> {
  return new Promise((resolve, reject) => {
    if (typeof window.WPP !== "undefined" && window.WPP) {
      console.log("[WPPBootstrap] WPP ya disponible");
      resolve(window.WPP);
      return;
    }

    const startTime = Date.now();
    let attempt = 0;

    const interval = setInterval(() => {
      attempt++;

      if (typeof window.WPP !== "undefined" && window.WPP) {
        clearInterval(interval);
        console.log(`[WPPBootstrap] WPP detectado tras ${attempt} intentos`);
        resolve(window.WPP);
        return;
      }

      if (Date.now() - startTime > WPP_WAIT_TIMEOUT) {
        clearInterval(interval);
        console.error(`[WPPBootstrap] Timeout: WPP no disponible tras ${WPP_WAIT_TIMEOUT}ms`);
        reject(new Error("WPP_LOAD_TIMEOUT"));
      }
    }, WPP_RETRY_INTERVAL);
  });
}

export function isWPPReady(): boolean {
  return typeof window.WPP !== "undefined" && !!window.WPP;
}

export function getWPP(): WPPGlobal | undefined {
  return window.WPP;
}
