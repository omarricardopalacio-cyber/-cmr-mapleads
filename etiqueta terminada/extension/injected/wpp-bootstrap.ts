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

/**
 * WhatsApp Web reciente a veces deja Wid/Chat sin isBot(); WA-JS / MsgModel
 * llaman c.isBot() al hidratar mensajes → "c.isBot is not a function".
 */
export function patchWhatsAppCompat(WPP?: WPPGlobal): void {
  const wpp = WPP || window.WPP;
  if (!wpp?.whatsapp) return;

  const patchIsBot = (proto: any, label: string) => {
    if (!proto || typeof proto.isBot === "function") return;
    try {
      proto.isBot = function isBot() {
        try {
          const ser = String(this?._serialized || this?.toString?.() || "");
          return ser.includes("bot") || !!this?.isBotAccount;
        } catch {
          return false;
        }
      };
      console.log(`[WPPBootstrap] Parche isBot aplicado en ${label}`);
    } catch {
      /* ignore */
    }
  };

  try {
    const wa = wpp.whatsapp as any;
    patchIsBot(wa.Wid?.prototype, "Wid");
    patchIsBot(wa.UserWid?.prototype, "UserWid");
    patchIsBot(wa.Chat?.prototype, "Chat");
    patchIsBot(wa.ChatModel?.prototype, "ChatModel");
    patchIsBot(wa.Contact?.prototype, "Contact");
    patchIsBot(wa.ContactModel?.prototype, "ContactModel");

    // Algunos builds exponen el método en el id del chat/contacto
    const sampleChat = wa.ChatStore?.getModelsArray?.()?.[0] || wa.ChatCollection?.getModelsArray?.()?.[0];
    const idProto = sampleChat?.id?.constructor?.prototype;
    patchIsBot(idProto, "chat.id");
  } catch (e) {
    console.warn("[WPPBootstrap] patchWhatsAppCompat:", e);
  }
}
