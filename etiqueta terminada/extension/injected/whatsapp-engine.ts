// ============================================================
// MAPLE WA ENGINE — Injected Script Entry Point
// Se inyecta en WhatsApp Web como script <script src="...">
// ============================================================

import { waitForWPP, isWPPReady } from "./wpp-bootstrap";
import { initEventEngine } from "./event-engine";
import { senderEngine } from "./sender-engine";
import { resolveCommandMedia } from "./command-media";
import { postFromInjected } from "../bridge/postmessage";
import * as chatDetector from "./chat-detector";
import * as contactDetector from "./contact-detector";

// Evitar inicialización doble
if ((window as any).__MAPLE_WA_ENGINE_INITIALIZED) {
  console.warn("[WhatsAppEngine] Ya inicializado, ignorando");
} else {
  (window as any).__MAPLE_WA_ENGINE_INITIALIZED = true;
  init();
}

async function init(): Promise<void> {
  console.log("[WhatsAppEngine] Iniciando...");

  try {
    await waitForWPP();
    console.log("[WhatsAppEngine] WPP listo");

    await initEventEngine();
    console.log("[WhatsAppEngine] EventEngine listo");

    // Notificar que la sesión está lista
    const WPP = (window as any).WPP;
    const myDevice = await WPP.whatsapp.Browser?.id?.();
    const phone = myDevice?.user || "";

    postFromInjected("WA_EVENT", {
      event: "SESSION_READY",
      payload: {
        sessionId: `wa-${phone}-${Date.now()}`,
        browserId: "chrome",
        deviceId: phone,
        phoneNumber: phone,
        profileName: document.querySelector('[data-testid="user-profile"]')?.textContent || "",
        isReady: true,
        connectedAt: Date.now(),
      },
    });

    // Escuchar comandos desde el Content Script
    window.addEventListener("message", handleCommands);

    console.log("[WhatsAppEngine] Listo y escuchando comandos");
  } catch (err) {
    console.error("[WhatsAppEngine] Error en inicialización:", err);
    postFromInjected("WA_EVENT", {
      event: "SESSION_LOST",
      payload: { error: (err as Error).message, timestamp: Date.now() },
    });
  }
}

async function handleCommands(event: MessageEvent): Promise<void> {
  // DEBUG: Log every message event to diagnose filtering issues
  console.log("[WhatsAppEngine] Message received:", {
    source: event.source,
    sourceIsWindow: event.source === window,
    sourceIsParent: event.source === window.parent,
    dataSource: event.data?.source,
    channel: event.data?.channel,
    id: event.data?.id,
  });

  // Chrome MV3: content script (isolated world) and injected script (main world)
  // do NOT share the same window object. event.source from content script postMessage
  // will NOT equal window. We remove this check to allow commands through.
  // Security note: we still verify msg.source === "MAPLE_WA_CONTENT" below.
  // if (event.source !== window.parent && event.source !== window) return;

  const msg = event.data;
  if (msg?.source !== "MAPLE_WA_CONTENT") return;
  if (msg?.channel !== "WA_COMMAND") return;

  const { id, event: rawCmdEvent, payload } = msg;
  const cmdEvent = (rawCmdEvent || "").toUpperCase().replace(/-/g, "_");
  console.log(`[WhatsAppEngine] Executing command: ${cmdEvent}, id: ${id}`);

  let response: any = null;
  let error: string | null = null;

  try {
    switch (cmdEvent) {
      case "SEND_MESSAGE": {
        const cmdPayload = (payload ?? {}) as Record<string, unknown>;
        console.log("[WhatsAppEngine] SEND_MESSAGE payload:", JSON.stringify({
          chatId: cmdPayload.chatId,
          text: cmdPayload.text,
          hasMedia: !!cmdPayload.media,
          mimeType: cmdPayload.mimeType || cmdPayload.mime_type,
        }));

        const resolved = await resolveCommandMedia(cmdPayload);
        console.log("[WhatsAppEngine] resolveCommandMedia result:", JSON.stringify({
          hasDataUri: !!resolved.dataUri,
          mimeType: resolved.mimeType,
        }));

        const mimeType =
          resolved.mimeType ||
          (cmdPayload.mimeType as string) ||
          (cmdPayload.mime_type as string);

        console.log("[WhatsAppEngine] Calling senderEngine.send with chatId:", cmdPayload.chatId);
        const sendResult = await senderEngine.send({
          chatId: cmdPayload.chatId as string,
          text: cmdPayload.text as string | undefined,
          media: resolved.dataUri,
          caption: cmdPayload.caption as string | undefined,
          quotedMsgId: cmdPayload.quotedMsgId as string | undefined,
          options: {
            ...(cmdPayload.options as Record<string, unknown> | undefined),
            mimeType,
            mimetype: mimeType,
          },
        });
        console.log("[WhatsAppEngine] senderEngine.send result:", JSON.stringify(sendResult));

        if (!sendResult.success) {
          error = sendResult.error || "SEND_FAILED";
        } else {
          response = { messageId: sendResult.messageId, sent: true };
        }
        break;
      }

      case "SEND_MEDIA": {
        // Backend envía: { chatId, mediaUrl (data URI base64 or signed URL), mimeType, caption }
        const resolved = await resolveCommandMedia(payload as Record<string, unknown>);
        const mediaData = payload.media || resolved.dataUri || payload.mediaUrl || payload.media_url;
        const mimeType = resolved.mimeType || payload.mimeType || payload.mime_type;
        if (!mediaData) {
          error = "MEDIA_MISSING";
          break;
        }
        const sendResult = await senderEngine.send({
          chatId: payload.chatId,
          text: payload.caption || payload.text,
          media: mediaData,
          caption: payload.caption,
          quotedMsgId: payload.quotedMsgId,
          options: {
            ...(payload.options || {}),
            mimetype: mimeType,
            mimeType,
          },
        });
        if (!sendResult.success) {
          error = sendResult.error || "SEND_FAILED";
        } else {
          response = { messageId: sendResult.messageId, sent: true };
        }
        break;
      }

      case "GET_ACTIVE_CHAT":
        response = await chatDetector.getActiveChat();
        break;

      case "GET_CHAT_LIST":
        response = await chatDetector.getChatList();
        break;

      case "GET_CHAT_MESSAGES":
        response = await chatDetector.getChatMessages(payload.chatId, payload.options);
        break;

      case "FIND_CHAT":
        response = await chatDetector.findChat(payload.chatId);
        break;

      case "GET_CONTACT_LIST":
        response = await contactDetector.getContactList();
        break;

      case "GET_CONTACT":
        response = await contactDetector.getContact(payload.contactId);
        break;

      case "GET_PROFILE_PICTURE":
        response = await contactDetector.getProfilePictureUrl(payload.contactId);
        break;

      case "GET_LABELS":
        response = await contactDetector.getLabels();
        break;

      case "GET_WPP_STATUS":
        response = {
          ready: isWPPReady(),
          timestamp: Date.now(),
        };
        break;

      case "PING":
        response = { pong: true, timestamp: Date.now() };
        break;

      default:
        error = `Comando desconocido: ${cmdEvent}`;
    }
  } catch (err: any) {
    error = err?.message || String(err);
    console.error(`[WhatsAppEngine] Error ejecutando ${cmdEvent}:`, err);
  }

  // Responder al Content Script
  const responsePayload = error ? { error } : response;
  console.log(`[WhatsAppEngine] Sending response for ${cmdEvent}:`, JSON.stringify(responsePayload));
  postFromInjected("WA_RESPONSE", {
    id,
    payload: responsePayload,
  });
}
