// ============================================================
// MAPLE WA ENGINE — Vigilante Bridge
// Health-check + auto-reinyección si dejan de entrar/salir msgs
// ============================================================

import type { ContentBridge } from "../bridge/bridge";

export type BridgeHealth = {
  healthy: boolean;
  phase: "ok" | "degraded" | "healing" | "critical";
  wppReady: boolean;
  engineReady: boolean;
  lastEventAt: number | null;
  lastHealAt: number | null;
  healCount: number;
  lastError: string | null;
  message: string;
  updatedAt: number;
};

const CHECK_MS = 45_000;
const HEAL_COOLDOWN_MS = 120_000;
const MAX_HEALS_PER_HOUR = 6;
const SILENCE_WARN_MS = 12 * 60_000; // sin eventos con engine listo

let started = false;
let healTimes: number[] = [];
let lastHealAt: number | null = null;
let lastError: string | null = null;
let phase: BridgeHealth["phase"] = "ok";

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.type = "text/javascript";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Error cargando ${src}`));
    (document.head || document.documentElement).appendChild(script);
  });
}

function injectInline(code: string): void {
  const script = document.createElement("script");
  script.textContent = code;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

async function persist(health: BridgeHealth): Promise<void> {
  try {
    await chrome.storage.local.set({ bridgeHealth: health });
  } catch {
    /* ignore */
  }
}

function buildHealth(bridge: ContentBridge, extras?: Partial<BridgeHealth>): BridgeHealth {
  const healthy = extras?.healthy ?? (bridge.engineReady && phase === "ok");
  return {
    healthy,
    phase,
    wppReady: extras?.wppReady ?? bridge.engineReady,
    engineReady: bridge.engineReady,
    lastEventAt: bridge.lastEventAt || null,
    lastHealAt,
    healCount: healTimes.length,
    lastError: extras?.lastError ?? lastError,
    message: extras?.message ?? (healthy ? "Bridge OK" : "Bridge degradado"),
    updatedAt: Date.now(),
  };
}

async function heal(bridge: ContentBridge, reason: string): Promise<void> {
  const now = Date.now();
  healTimes = healTimes.filter((t) => now - t < 60 * 60_000);
  if (healTimes.length >= MAX_HEALS_PER_HOUR) {
    phase = "critical";
    lastError = `Demasiadas auto-reparaciones (${reason})`;
    await persist(
      buildHealth(bridge, {
        healthy: false,
        wppReady: false,
        message: "Vigilante: límite de auto-reparación. Recarga WhatsApp Web.",
        lastError,
      }),
    );
    console.warn("[VigilanteBridge]", lastError);
    return;
  }
  if (lastHealAt && now - lastHealAt < HEAL_COOLDOWN_MS) {
    return;
  }

  phase = "healing";
  lastHealAt = now;
  healTimes.push(now);
  lastError = reason;
  await persist(
    buildHealth(bridge, {
      healthy: false,
      wppReady: false,
      message: `Auto-reparando: ${reason}`,
      lastError: reason,
    }),
  );
  console.warn("[VigilanteBridge] Reinyectando engine:", reason);

  try {
    // Permitir re-init del engine (guarda __MAPLE_WA_ENGINE_INITIALIZED)
    injectInline(`
      try {
        window.__MAPLE_WA_ENGINE_INITIALIZED = false;
        window.__MAPLE_CONTACT_ENRICHER_LOADED = false;
      } catch (e) {}
    `);

    // Reaplicar WA-JS por si el loader quedó a medias (idempotente)
    const wppUrl = chrome.runtime.getURL("vendor/wppconnect-wa.min.js");
    await injectScript(wppUrl);
    await new Promise((r) => setTimeout(r, 1500));

    const engineUrl = chrome.runtime.getURL("injected/whatsapp-engine.js");
    await injectScript(engineUrl);

    // Dar tiempo a SESSION_READY
    await new Promise((r) => setTimeout(r, 4000));
    const probe = await bridge.probeWpp();
    if (probe.ready || bridge.engineReady) {
      phase = "ok";
      lastError = null;
      await persist(
        buildHealth(bridge, {
          healthy: true,
          wppReady: true,
          message: "Bridge recuperado tras auto-reparación",
        }),
      );
      console.log("[VigilanteBridge] Recuperación OK");
    } else {
      phase = "degraded";
      lastError = probe.error || "WPP no responde tras heal";
      await persist(
        buildHealth(bridge, {
          healthy: false,
          wppReady: false,
          message: "Auto-reparación parcial — revisa WhatsApp Web",
          lastError,
        }),
      );
    }
  } catch (err: any) {
    phase = "critical";
    lastError = err?.message || String(err);
    await persist(
      buildHealth(bridge, {
        healthy: false,
        wppReady: false,
        message: "Fallo en auto-reparación",
        lastError,
      }),
    );
  }
}

async function tick(bridge: ContentBridge): Promise<void> {
  const probe = await bridge.probeWpp();
  const now = Date.now();
  const silence =
    bridge.engineReady &&
    bridge.lastEventAt > 0 &&
    now - bridge.lastEventAt > SILENCE_WARN_MS;

  if (!probe.ready && !bridge.engineReady) {
    phase = "degraded";
    lastError = probe.error || "WPP no listo";
    await persist(
      buildHealth(bridge, {
        healthy: false,
        wppReady: false,
        message: "Sin WPP — intentando recuperar",
        lastError,
      }),
    );
    await heal(bridge, lastError);
    return;
  }

  if (!probe.ready && bridge.engineReady) {
    // Engine creyó estar listo pero probe falla → reinyectar
    phase = "degraded";
    lastError = probe.error || "probe_failed";
    await persist(
      buildHealth(bridge, {
        healthy: false,
        wppReady: false,
        message: "Probe WPP falló",
        lastError,
      }),
    );
    await heal(bridge, String(lastError));
    return;
  }

  if (silence) {
    phase = "degraded";
    await persist(
      buildHealth(bridge, {
        healthy: true,
        wppReady: true,
        message: "Sin eventos recientes (posible silencio normal)",
        lastError: null,
      }),
    );
    // Silencio largo: un probe de listado barato
    try {
      const id = `wd-list-${Date.now()}`;
      const list = await bridge.sendToInjected({
        id,
        channel: "WA_COMMAND",
        event: "GET_CHAT_LIST",
        payload: { limit: 1, slim: true },
      } as any);
      if (list?.error) {
        await heal(bridge, String(list.error));
        return;
      }
    } catch (err: any) {
      await heal(bridge, err?.message || "chat_list_timeout");
      return;
    }
  }

  phase = "ok";
  lastError = null;
  await persist(
    buildHealth(bridge, {
      healthy: true,
      wppReady: true,
      message: "Bridge OK — mensajes entrando/saliendo",
    }),
  );
}

export function startBridgeWatchdog(bridge: ContentBridge): void {
  if (started) return;
  started = true;
  console.log("[VigilanteBridge] Activo");

  void persist(
    buildHealth(bridge, {
      healthy: false,
      wppReady: false,
      message: "Iniciando vigilante…",
    }),
  );

  // Primera chequeo tras dar tiempo al engine
  setTimeout(() => void tick(bridge), 20_000);
  setInterval(() => void tick(bridge), CHECK_MS);
}
