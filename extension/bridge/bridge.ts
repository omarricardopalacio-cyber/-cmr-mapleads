// ============================================================
// MAPLE WA ENGINE — Bridge Orchestrator
// Conecta Injected Script ↔ Content Script ↔ Background Worker
// ============================================================

import { eventBus } from "./event-bus";
import { postFromContent, postFromInjected, sendToBackground, broadcastToTabs } from "./postmessage";
import type { BridgeMessage, WAEvent } from "../shared/types";
import { CONSTANTS } from "../shared/contracts";

// ============================================================
// Content Script Bridge (coordina injected ↔ background)
// ============================================================

export class ContentBridge {
  private initialized = false;
  private pendingResponses: Map<string, (payload: any) => void> = new Map();
  public engineReady = false; // Se pone true cuando el injected engine envía eventos

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Escuchar mensajes desde el INJECTED script (via window.postMessage)
    window.addEventListener("message", this.handleInjectedMessage);

    // Escuchar mensajes desde el BACKGROUND (via chrome.runtime)
    chrome.runtime.onMessage.addListener(this.handleBackgroundMessage);

    console.log("[ContentBridge] Inicializado");
  }

  private handleInjectedMessage = (event: MessageEvent) => {
    // NOTA: event.source puede ser diferente de window porque el content script
    // corre en isolated world (su window no es el mismo objeto que el de la página).
    // Solo verificamos que el mensaje venga del mismo frame y tenga nuestra marca.
    const msg = event.data;
    if (msg?.source !== "MAPLE_WA_INJECTED") return;

    const bridgeMsg = msg as BridgeMessage & { source: string };

    // Reenviar eventos de WA al backend vía background
    if (bridgeMsg.channel === "WA_EVENT" && bridgeMsg.event) {
      // Engine confirmado funcionando (WPP envió eventos o SESSION_READY)
      if (!this.engineReady) {
        this.engineReady = true;
        console.log("[ContentBridge] Engine confirmado listo (WPP activo)");
      }

      const waEvent: WAEvent = {
        id: bridgeMsg.id || `${Date.now()}`,
        type: bridgeMsg.event,
        payload: bridgeMsg.payload,
        timestamp: Date.now(),
      };

      // Emitir localmente en el content script (para debug / UI)
      eventBus.emit(bridgeMsg.event, bridgeMsg.payload);

      // Enviar al background para ingest
      sendToBackground("WA_EVENT", { event: bridgeMsg.event, payload: waEvent }).catch(
        (err) => console.warn("[ContentBridge] Error enviando a background:", err)
      );
    }

    // Respuestas a comandos
    if (bridgeMsg.channel === "WA_RESPONSE" && bridgeMsg.id) {
      const resolver = this.pendingResponses.get(bridgeMsg.id);
      if (resolver) {
        resolver(bridgeMsg.payload);
        this.pendingResponses.delete(bridgeMsg.id);
      }
    }
  };

  private handleBackgroundMessage = (
    message: any,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    if (message?.source !== "MAPLE_WA_BACKGROUND") return false;

    const bridgeMsg = message as BridgeMessage;

    // Comando del backend → forwarded al injected script
    if (bridgeMsg.channel === "WA_COMMAND") {
      this.sendToInjected(bridgeMsg).then(sendResponse).catch(sendResponse);
      return true; // Async response
    }

    // Broadcast de eventos
    if (bridgeMsg.channel === "WA_EVENT") {
      eventBus.emit(bridgeMsg.event!, bridgeMsg.payload);
      sendResponse({ ok: true });
      return false;
    }

    return false;
  };

  // Enviar comando al injected script y esperar respuesta
  sendToInjected(msg: BridgeMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(msg.id!);
        reject(new Error("[ContentBridge] Timeout esperando respuesta del injected script"));
      }, 15000);

      this.pendingResponses.set(msg.id!, (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });

      postFromContent("WA_COMMAND", {
        id: msg.id,
        event: msg.event,
        payload: msg.payload,
      });
    });
  }

  destroy() {
    window.removeEventListener("message", this.handleInjectedMessage);
    this.pendingResponses.clear();
    this.initialized = false;
  }
}

// ============================================================
// Background Bridge (coordina content ↔ backend API)
// ============================================================

export class BackgroundBridge {
  private initialized = false;

  init() {
    if (this.initialized) return;
    this.initialized = true;

    chrome.runtime.onMessage.addListener(this.handleContentMessage);
    console.log("[BackgroundBridge] Inicializado");
  }

  private handleContentMessage = (
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    if (message?.source !== "MAPLE_WA_CONTENT") return false;

    const bridgeMsg = message as BridgeMessage;

    // Eventos de WA → guardar en cola para ingest
    if (bridgeMsg.channel === "WA_EVENT") {
      this.handleWAEvent(bridgeMsg, sender.tab?.id)
        .then((result) => sendResponse({ ok: true, payload: result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // Solicitudes directas del content script
    if (bridgeMsg.channel === "WA_REQUEST") {
      sendResponse({ ok: true, payload: bridgeMsg.payload });
      return false;
    }

    return false;
  };

  private async handleWAEvent(msg: BridgeMessage, tabId?: number): Promise<void> {
    console.log("[BackgroundBridge] Evento recibido:", msg.event, msg.payload);

    // Guardar evento en chrome.storage.local como buffer temporal
    // El service worker (flushIngestQueue) lee de aquí y envía al backend
    try {
      const waEvent: WAEvent = {
        id: msg.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: msg.event!,
        payload: msg.payload,
        timestamp: Date.now(),
      };

      // Usar chrome.storage.local (disponible en background sin IndexedDB)
      const result = await chrome.storage.local.get("eventQueue");
      const queue: WAEvent[] = result.eventQueue || [];
      queue.push(waEvent);
      // Mantener solo los últimos 500 eventos
      if (queue.length > 500) queue.splice(0, queue.length - 500);
      await chrome.storage.local.set({ eventQueue: queue });
      console.log("[BackgroundBridge] Evento encolado para ingest:", msg.event, "cola:", queue.length);
    } catch (err) {
      console.error("[BackgroundBridge] Error encolando evento:", err);
    }
  }

  // Enviar comando a una tab específica de WhatsApp Web
  async sendCommandToTab(tabId: number, command: BridgeMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout enviando comando a tab")), 10000);
      chrome.tabs.sendMessage(
        tabId,
        { source: "MAPLE_WA_BACKGROUND", ...command },
        (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  destroy() {
    chrome.runtime.onMessage.removeListener(this.handleContentMessage);
    this.initialized = false;
  }
}
