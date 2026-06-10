// ============================================================
// MAPLE WA ENGINE — Content Script Bridge Listener (helpers)
// ============================================================

import { eventBus } from "../bridge/event-bus";
import { sendToBackground } from "../bridge/postmessage";
import type { BridgeMessage, WAEvent, WAEventType } from "../shared/types";

// Escuchar eventos del injected script y reenviar al backend
export function setupBridgeListener(): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg?.source !== "MAPLE_WA_INJECTED") return;

    const bridgeMsg = msg as BridgeMessage & { source: string };

    if (bridgeMsg.channel === "WA_EVENT" && bridgeMsg.event) {
      const waEvent: WAEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: bridgeMsg.event as WAEventType,
        payload: bridgeMsg.payload,
        timestamp: Date.now(),
      };

      sendToBackground("WA_EVENT", {
        event: bridgeMsg.event as WAEventType,
        payload: waEvent,
      }).catch((err) => {
        console.warn("[BridgeListener] Error enviando a background:", err);
      });
    }
  });
}
