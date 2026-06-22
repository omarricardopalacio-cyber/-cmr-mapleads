// ============================================================
// MAPLE WA ENGINE — Injected Script Entry Point
// Se inyecta en WhatsApp Web como script <script src="...">
// ============================================================

import { waitForWPP, isWPPReady } from "./wpp-bootstrap";
import { initEventEngine } from "./event-engine";
import { senderEngine } from "./sender-engine";
import { resolveCommandMedia } from "./command-media";
import { postFromInjected, postFromContent } from "../bridge/postmessage";
import * as chatDetector from "./chat-detector";
import * as contactDetector from "./contact-detector";

// Evitar inicialización doble
if ((window as any).__MAPLE_WA_ENGINE_INITIALIZED) {
  console.warn("[WhatsAppEngine] Ya inicializado, ignorando");
} else {
  (window as any).__MAPLE_WA_ENGINE_INITIALIZED = true;
  init();
}

const pendingRequests = new Map<string, (payload: any) => void>();

function requestExtension(event: string, payload: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("[WhatsAppEngine] Timeout esperando respuesta de extensión"));
    }, 20000);

    pendingRequests.set(id, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });

    postFromContent("WA_REQUEST", { id, event, payload });
  });
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

  const msg = event.data;
  if (msg?.source !== "MAPLE_WA_CONTENT") return;

  if (msg?.channel === "WA_RESPONSE" && msg?.id) {
    const resolver = pendingRequests.get(msg.id);
    if (resolver) {
      resolver(msg.payload);
      pendingRequests.delete(msg.id);
    }
    return;
  }

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
        const payloadMediaUrl = (cmdPayload.mediaUrl || cmdPayload.media_url) as string | undefined;
        console.log("[WhatsAppEngine] SEND_MESSAGE payload:", JSON.stringify({
          chatId: cmdPayload.chatId,
          text: cmdPayload.text,
          hasMedia: !!cmdPayload.media,
          hasMediaUrl: !!payloadMediaUrl,
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

        // Si resolveCommandMedia no devolvió dataUri (pasa para URLs HTTP de archivos grandes),
        // usamos la URL directamente. senderEngine.send() tiene fetchUrlAsBlob() como fallback
        // para URLs HTTP, por lo que puede descargar el archivo directamente en el contexto
        // inyectado de WhatsApp Web (sin limitaciones de memoria del service worker).
        const mediaToSend: string | undefined = resolved.dataUri || payloadMediaUrl;

        console.log("[WhatsAppEngine] Calling senderEngine.send with chatId:", cmdPayload.chatId, "hasMedia:", !!mediaToSend);
        const sendResult = await senderEngine.send({
          chatId: cmdPayload.chatId as string,
          text: cmdPayload.text as string | undefined,
          media: mediaToSend,
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
        // Backend envía: { chatId, mediaUrl / media_url (data URI base64 or signed URL), mimeType, caption }
        const resolved = await resolveCommandMedia(payload as Record<string, unknown>);
        const payloadUrl = typeof payload.mediaUrl === "string"
          ? payload.mediaUrl
          : typeof payload.media_url === "string"
          ? payload.media_url
          : undefined;
        const mediaUrl = payload.media || resolved.dataUri || payloadUrl;
        const mimeType = resolved.mimeType || payload.mimeType || payload.mime_type;
        console.log("[WhatsAppEngine] SEND_MEDIA payload:", JSON.stringify({
          chatId: payload.chatId,
          mediaUrl: payloadUrl,
          resolvedDataUri: !!resolved.dataUri,
          mimeType,
          caption: payload.caption,
        }));

        let mediaData = payload.media || resolved.dataUri;
        if (!mediaData && payloadUrl && payloadUrl.startsWith("http")) {
          const fetchResult = await requestExtension("FETCH_MEDIA", {
            url: payloadUrl,
            mimeType,
          });
          console.log("[WhatsAppEngine] FETCH_MEDIA response recibida del extension:", fetchResult);
          if (fetchResult?.error) {
            error = fetchResult.error;
            break;
          }
          mediaData = fetchResult.dataUri ?? fetchResult.blob ?? fetchResult.media ?? fetchResult.data;
          console.log("[WhatsAppEngine] Media fetched from extension:", {
            hasDataUri: typeof mediaData === "string" && mediaData.startsWith("data:"),
            mimeType: fetchResult.mimeType,
          });
        }

        const finalMedia = mediaData || payloadUrl;
        if (!finalMedia) {
          error = "MEDIA_MISSING";
          break;
        }
        const sendResult = await senderEngine.send({
          chatId: payload.chatId,
          text: payload.caption || payload.text,
          media: finalMedia,
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
