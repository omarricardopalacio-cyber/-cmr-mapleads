// ============================================================
// MAPLE WA ENGINE — Bridge Orchestrator
// Conecta Injected Script ↔ Content Script ↔ Background Worker
// ============================================================

import { eventBus } from "./event-bus";
import { postFromContent, postFromInjected, sendToBackground, broadcastToTabs } from "./postmessage";
import type { BridgeMessage, WAEvent, WAEventType } from "../shared/types";
import { CONSTANTS } from "../shared/contracts";

// ============================================================
// Content Script Bridge (coordina injected ↔ background)
// ============================================================

export class ContentBridge {
  private initialized = false;
  private pendingResponses: Map<string, (payload: any) => void> = new Map();
  public engineReady = false; // Se pone true cuando el injected engine envía eventos
  public lastEventAt = 0;
  public lastCommandAt = 0;
  public lastCommandOk = false;
  public lastProbeError: string | null = null;

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
      this.lastEventAt = Date.now();
      if (!this.engineReady) {
        this.engineReady = true;
        console.log("[ContentBridge] Engine confirmado listo (WPP activo)");
      }

      const waEvent: WAEvent = {
        id: bridgeMsg.id || `${Date.now()}`,
        type: bridgeMsg.event as WAEventType,
        payload: bridgeMsg.payload,
        timestamp: Date.now(),
      };

      // Emitir localmente en el content script (para debug / UI)
      eventBus.emit(bridgeMsg.event as WAEventType, bridgeMsg.payload);

      // Enviar al background para ingest
      sendToBackground("WA_EVENT", { event: bridgeMsg.event, payload: waEvent }).catch(
        (err) => console.warn("[ContentBridge] Error enviando a background:", err)
      );
    }

    // Respuestas a comandos
    if (bridgeMsg.channel === "WA_RESPONSE" && bridgeMsg.id) {
      const resolver = this.pendingResponses.get(bridgeMsg.id);
      if (resolver) {
        console.log("[ContentBridge] WA_RESPONSE recibido para id:", bridgeMsg.id);
        resolver(bridgeMsg.payload);
        this.pendingResponses.delete(bridgeMsg.id);
      } else {
        console.warn("[ContentBridge] WA_RESPONSE sin resolver registrado para id:", bridgeMsg.id, bridgeMsg.payload);
      }
      return;
    }

    // Peticiones del injected script a este content script
    if (bridgeMsg.channel === "WA_REQUEST" && bridgeMsg.event === "FETCH_MEDIA") {
      console.log("[ContentBridge] WA_REQUEST FETCH_MEDIA recibido desde injected:", bridgeMsg.id, bridgeMsg.payload);
      (async () => {
        try {
          const result = await sendToBackground("WA_REQUEST", {
            event: "FETCH_MEDIA",
            payload: bridgeMsg.payload,
          });
          console.log("[ContentBridge] Resultado de background WA_REQUEST FETCH_MEDIA:", result);
          postFromContent("WA_RESPONSE", {
            id: bridgeMsg.id,
            payload: result?.payload ?? { error: "Sin respuesta de background" },
          });
        } catch (err: any) {
          console.error("[ContentBridge] Error enviando FETCH_MEDIA a background:", err);
          postFromContent("WA_RESPONSE", {
            id: bridgeMsg.id,
            payload: { error: err?.message ?? String(err) },
          });
        }
      })();
      return;
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
      this.sendToInjected(bridgeMsg)
        .then((result) => sendResponse(result))
        .catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn("[ContentBridge] Error ejecutando comando:", errMsg);
          sendResponse({ error: errMsg });
        });
      return true; // Async response
    }

    // Broadcast de eventos
    if (bridgeMsg.channel === "WA_EVENT") {
      eventBus.emit(bridgeMsg.event as WAEventType, bridgeMsg.payload);
      sendResponse({ ok: true });
      return false;
    }

    return false;
  };

  // Enviar comando al injected script y esperar respuesta
  sendToInjected(msg: BridgeMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const cmd = String(msg.event || "").toUpperCase();
      const waitMs =
        cmd === "GET_CHAT_LIST" ||
        cmd === "GET_CHAT_MESSAGES" ||
        cmd === "GET_CONTACT_LIST" ||
        cmd === "SEND_MESSAGE" ||
        cmd === "SEND_MEDIA" ||
        cmd === "SEND_BROADCAST"
          ? 120000
          : 15000;
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(msg.id!);
        reject(new Error("[ContentBridge] Timeout esperando respuesta del injected script"));
      }, waitMs);

      this.pendingResponses.set(msg.id!, (payload) => {
        clearTimeout(timeout);
        this.lastCommandAt = Date.now();
        this.lastCommandOk = !(payload && typeof payload === "object" && "error" in payload && payload.error);
        if (!this.lastCommandOk) {
          this.lastProbeError = String((payload as any)?.error || "command_error");
        } else {
          this.lastProbeError = null;
        }
        resolve(payload);
      });

      postFromContent("WA_COMMAND", {
        id: msg.id,
        event: msg.event,
        payload: msg.payload,
      });
    });
  }

  /** Probe ligero para el Vigilante Bridge */
  async probeWpp(): Promise<{ ready: boolean; error?: string }> {
    try {
      const id = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const result = await this.sendToInjected({
        id,
        channel: "WA_COMMAND",
        event: "GET_WPP_STATUS",
        payload: {},
      } as BridgeMessage);
      if (result?.error) return { ready: false, error: String(result.error) };
      return { ready: !!result?.ready };
    } catch (err: any) {
      return { ready: false, error: err?.message || String(err) };
    }
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
    // IMPORTANTE: no responder aquí. El service-worker.ts maneja WA_REQUEST
    // (FETCH_MEDIA, START_HISTORY_IMPORT, etc.). Si respondemos antes,
    // robamos la respuesta y el popup/content cree que no pasó nada.
    if (bridgeMsg.channel === "WA_REQUEST") {
      return false;
    }

    return false;
  };

  private async handleWAEvent(msg: BridgeMessage, tabId?: number): Promise<void> {
    console.log("[BackgroundBridge] Evento recibido:", msg.event, msg.payload);
    // La cola de ingest la gestiona service-worker.ts (handleWAEvent) para evitar duplicados.
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
