// ============================================================
// MAPLE WA ENGINE — PostMessage Bridge (Injected ↔ Content)
// ============================================================

import type { BridgeMessage } from "../shared/types";
import { CONSTANTS } from "../shared/contracts";

// ID único para requests
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================
// PostMessage desde Injected Script → Content Script
// ============================================================

export function postFromInjected(
  channel: BridgeMessage["channel"],
  data: { event?: string; payload?: any; id?: string }
): void {
  const message: BridgeMessage = {
    direction: "INJECTED_TO_CONTENT",
    channel,
    id: data.id || generateId(),
    event: data.event,
    payload: data.payload,
  };
  window.postMessage(
    { source: "MAPLE_WA_INJECTED", ...message },
    "https://web.whatsapp.com"
  );
}

// ============================================================
// PostMessage desde Content Script → Injected Script
// ============================================================

export function postFromContent(
  channel: BridgeMessage["channel"],
  data: { event?: string; payload?: any; id?: string }
): void {
  const message: BridgeMessage = {
    direction: "CONTENT_TO_INJECTED",
    channel,
    id: data.id || generateId(),
    event: data.event,
    payload: data.payload,
  };
  window.postMessage(
    { source: "MAPLE_WA_CONTENT", ...message },
    "https://web.whatsapp.com"
  );
}

// ============================================================
// PostMessage desde Content Script → Background
// ============================================================

export function sendToBackground(
  channel: BridgeMessage["channel"],
  data: { event?: string; payload?: any; id?: string }
): Promise<any> {
  const message = {
    source: "MAPLE_WA_CONTENT",
    direction: "CONTENT_TO_BACKGROUND",
    channel,
    event: data.event,
    payload: data.payload,
  };
  return chrome.runtime.sendMessage(message);
}

// ============================================================
// Background → Content Script (a todas las tabs de WA Web)
// ============================================================

export async function broadcastToTabs(
  channel: BridgeMessage["channel"],
  data: { event?: string; payload?: any }
): Promise<void> {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  const message = {
    source: "MAPLE_WA_BACKGROUND",
    direction: "BACKGROUND_TO_CONTENT",
    channel,
    id: generateId(),
    event: data.event,
    payload: data.payload,
  };
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Tab puede estar cerrada o no lista
      });
    }
  }
}
