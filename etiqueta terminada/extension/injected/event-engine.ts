// ============================================================
// MAPLE WA ENGINE — Event Engine (Injected Script)
// Registra todos los listeners de WPP y los reenvía al bridge
// ============================================================

import { waitForWPP, getWPP } from "./wpp-bootstrap";
import { getMessageById } from "./message-detector";
import { postFromInjected } from "../bridge/postmessage";
import type { WAEventType } from "../shared/types";
import { sanitizeMessageBody, isWhatsAppSystemText } from "../shared/message-text";
import { canonicalWaId, sanitizePhoneForIngest } from "../shared/wa-identity";
import {
  applyIdentityToMessage,
  fetchProfilePictureUrl,
  ownAvatarPayload,
  resolveContactCard,
  resolveLidToPhoneDigits,
} from "./lid-resolver";

declare global {
  interface Window {
    __MAPLE_CONTACT_ENRICHER_LOADED?: boolean;
  }
}

let listenersInitialized = false;
let cleanupFns: Array<() => void> = [];

export async function initEventEngine(): Promise<void> {
  if (listenersInitialized) {
    console.warn("[EventEngine] Listeners ya inicializados, ignorando");
    return;
  }

  try {
    await waitForWPP();
    const WPP = getWPP();
    if (!WPP) {
      throw new Error("WPP no disponible");
    }

    registerNewMessage(WPP);
    registerActiveChat(WPP);
    registerPresenceChange(WPP);
    registerLabelUpdate(WPP);
    registerStreamInfo(WPP);

    listenersInitialized = true;
    console.log("[EventEngine] Todos los listeners registrados");
  } catch (err) {
    console.error("[EventEngine] Error inicializando:", err);
    throw err;
  }
}

function emit(event: WAEventType, payload: any): void {
  postFromInjected("WA_EVENT", { event, payload });
}

/**
 * Valida que un base64 contenga datos de imagen/video reales.
 * Retorna los primeros bytes hex para diagnóstico.
 */
function validateBase64Media(base64Data: string): { valid: boolean; firstBytesHex: string; detectedType: string } {
  try {
    // Quitar prefijo data URI si existe
    // WhatsApp usa MIME con parámetros: audio/ogg; codecs=opus.
    const clean = base64Data.replace(/^data:[^,]*;base64,/i, "").replace(/\s/g, "");
    if (
      clean.length < 12 ||
      clean.length % 4 === 1 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)
    ) {
      return { valid: false, firstBytesHex: "invalid_base64", detectedType: "unknown" };
    }

    const binary = atob(clean);
    if (binary.length < 8) {
      return { valid: false, firstBytesHex: "too_short", detectedType: "unknown" };
    }
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) bytes[i] = binary.charCodeAt(i);

    const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join(" ");

    // Firmas mágicas
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return { valid: true, firstBytesHex: hex, detectedType: "image/jpeg" };
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return { valid: true, firstBytesHex: hex, detectedType: "image/png" };
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { valid: true, firstBytesHex: hex, detectedType: "image/gif" };
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return { valid: true, firstBytesHex: hex, detectedType: "image/webp" };
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00 && (bytes[3] === 0x18 || bytes[3] === 0x20) && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return { valid: true, firstBytesHex: hex, detectedType: "video/mp4" };
    if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return { valid: true, firstBytesHex: hex, detectedType: "video/webm" };

    // AUDIO (las notas de voz de WhatsApp son OGG/Opus)
    if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return { valid: true, firstBytesHex: hex, detectedType: "audio/ogg" }; // "OggS"
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return { valid: true, firstBytesHex: hex, detectedType: "audio/mpeg" }; // "ID3" (mp3)
    if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return { valid: true, firstBytesHex: hex, detectedType: "audio/mpeg" }; // MP3 frame sync
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return { valid: true, firstBytesHex: hex, detectedType: "audio/mp4" }; // ...ftyp (m4a/aac)
    if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) return { valid: true, firstBytesHex: hex, detectedType: "audio/flac" }; // "fLaC"
    if (bytes[0] === 0x23 && bytes[1] === 0x21 && bytes[2] === 0x41 && bytes[3] === 0x4D && bytes[4] === 0x52) return { valid: true, firstBytesHex: hex, detectedType: "audio/amr" }; // "#!AMR"

    return { valid: false, firstBytesHex: hex, detectedType: "unknown/encrypted" };
  } catch (e) {
    return { valid: false, firstBytesHex: "decode_error", detectedType: "error" };
  }
}

function isAudioMessage(msg: any): boolean {
  return (
    msg?.type === "ptt" ||
    msg?.type === "audio" ||
    String(msg?.mimetype || "").toLowerCase().startsWith("audio/")
  );
}

function registerNewMessage(WPP: NonNullable<typeof window.WPP>): void {
  // Handler SIN async/await: retorna al instante para no bloquear el pipeline de WhatsApp
  // (afecta mensajes salientes, entrantes, texto e imágenes por igual).
  const handler = (...args: any[]) => {
    const msg = args[0];
    if (!msg) return;
    void processNewMessage(msg).catch((err) =>
      console.error("[EventEngine] Error procesando mensaje:", err)
    );
  };

  if (typeof WPP.on === "function") {
    WPP.on("chat.new_message", handler);
  } else if (typeof WPP.prependListener === "function") {
    console.warn("[EventEngine] WPP.on no disponible, fallback a prependListener");
    WPP.prependListener("chat.new_message", handler, { objectify: true });
  } else {
    console.warn("[EventEngine] WPP no soporta on ni prependListener para chat.new_message");
  }
  cleanupFns.push(() => WPP.off("chat.new_message", handler));
}

function registerActiveChat(WPP: NonNullable<typeof window.WPP>): void {
  const handler = (chat: any) => {
    if (!chat) return;

    try {
      const normalized = normalizeChat(chat);
      emit("ACTIVE_CHAT_CHANGED", normalized);
      const chatId = String(normalized?.chatId || "");
      if (!chatId || chatId.endsWith("@g.us")) return;
      // Al abrir el chat WhatsApp hidrata LID→teléfono y la foto. Enriquecer
      // después de un breve respiro para no competir con el render del chat.
      setTimeout(() => {
        void resolveContactCard(chatId, { chat })
          .then((card) => {
            if (!card) return;
            const lidKey = chatId.endsWith("@lid") ? canonicalWaId(chatId) : "";
            emit("CONTACT_INFO", {
              ...card,
              ...ownAvatarPayload(),
              waId: lidKey || card.waId,
              chatId: lidKey || card.chatId,
            });
          })
          .catch(() => {});
      }, 600);
    } catch (err) {
      console.error("[EventEngine] Error normalizando chat activo:", err);
    }
  };

  WPP.on("chat.active_chat", handler);
  cleanupFns.push(() => WPP.off("chat.active_chat", handler));
}

function registerPresenceChange(WPP: NonNullable<typeof window.WPP>): void {
  const handler = (data: any) => {
    emit("PRESENCE_CHANGED", {
      chatId: data.chatId || data.id?._serialized,
      isOnline: data.isOnline,
      isTyping: data.isTyping,
      isRecording: data.isRecording,
      lastSeen: data.lastSeen,
    });
  };

  WPP.on("chat.presence_change", handler);
  cleanupFns.push(() => WPP.off("chat.presence_change", handler));
}

function registerLabelUpdate(WPP: NonNullable<typeof window.WPP>): void {
  const handler = (data: any) => {
    emit("LABEL_UPDATED", {
      chatId: data.chatId || data.id?._serialized,
      labels: data.labels || [],
      action: data.action,
    });
  };

  WPP.on("chat.update_label", handler);
  cleanupFns.push(() => WPP.off("chat.update_label", handler));
}

function registerStreamInfo(WPP: NonNullable<typeof window.WPP>): void {
  const handler = (state: string) => {
    emit("CONNECTION_STATE_CHANGED", {
      state,
      isSynchronized: state === "NORMAL",
    });
  };

  WPP.on("conn.stream_info_changed", handler);
  cleanupFns.push(() => WPP.off("conn.stream_info_changed", handler));
}

function getMyPhoneNumber(): string | undefined {
  try {
    const WPP = getWPP();
    if (!WPP) return undefined;
    // Intentar múltiples APIs de WPP para obtener el número
    const me = WPP.whatsapp?.UserPrefs?.getMaybeMeUser?.() || WPP.whatsapp?.UserPrefs?.getMe?.();
    if (me?.user) {
      try { (window as any).__MAPLE_ME_PHONE__ = me.user; } catch {}
      return me.user;
    }
    const conn = WPP.whatsapp?.Stream?.get?.();
    if (conn?.wid?.user) {
      try { (window as any).__MAPLE_ME_PHONE__ = conn.wid.user; } catch {}
      return conn.wid.user;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ============================================================
// Normalizadores
// ============================================================

async function blobUrlToBase64(blobUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn("[MAPLE MULTIMEDIA] Error convirtiendo blob URL a base64:", err);
    return null;
  }
}

/**
 * FIX: Función universal que convierte CUALQUIER tipo de resultado de WPP
 * (string, Blob, ArrayBuffer, TypedArray, objecto con .body/.data/.base64) a data URI.
 * La versión que sí recibe imágenes usa este patrón en lugar de manejar
 * cada tipo inline, lo que evita fallos silenciosos con Blobs y ArrayBuffers.
 */
async function resolveToBase64(data: any, mimetype?: string): Promise<string | null> {
  if (!data) return null;
  if (typeof data === "string") {
    const value = data.trim();
    if (!value) return null;
    if (value.startsWith("blob:")) return blobUrlToBase64(value);
    if (value.startsWith("data:")) {
      return /^data:[^,]*;base64,/i.test(value) ? value : null;
    }
    // Algunas APIs de WA-JS devuelven base64 puro. Rechazar URLs, mensajes
    // de error y objetos serializados que antes se confundían con audio.
    if (
      value.length >= 12 &&
      value.length % 4 !== 1 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value.replace(/\s/g, ""))
    ) {
      return value;
    }
    return null;
  }

  // Blob
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    if (data.size === 0) return null;
    return new Promise<string | null>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(data);
    });
  }

  // ArrayBuffer o TypedArray
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(
          (data as ArrayBufferView).buffer,
          (data as ArrayBufferView).byteOffset,
          (data as ArrayBufferView).byteLength,
        );
    if (bytes.byteLength === 0) return null;
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return "data:" + (mimetype || "application/octet-stream") + ";base64," + btoa(binary);
  }

  // Objecto con campos conocidos
  if (typeof data.body === "string" && data.body) return data.body;
  if (typeof data.data === "string" && data.data) return data.data;
  if (typeof data.base64 === "string" && data.base64) return data.base64;
  if (data._blob) return resolveToBase64(data._blob, mimetype);
  if (data._arrayBuffer) return resolveToBase64(data._arrayBuffer, mimetype);

  return null;
}

/** Emite al CRM de inmediato con datos síncronos — cero awaits, no bloquea WhatsApp. */
function buildMessageFast(msg: any): any {
  let author: any = undefined;
  if (msg.__x_author) {
    author = {
      device: msg.__x_author.device,
      server: msg.__x_author.server,
      user: msg.__x_author.user,
      serialized: msg.__x_author._serialized,
    };
  }

  const media = extractMediaData(msg);
  const hasMediaIndicators =
    msg.isMedia || msg.mediaKey || msg.clientUrl || msg.deprecatedMms3Url || msg.mediaData;
  if (media && hasMediaIndicators) {
    media.missing_media = true;
  }

  const cleanBody = sanitizeMessageBody({
    body: msg.body,
    caption: msg.caption,
    isMedia: msg.isMedia,
    type: msg.type,
  });

  return {
    messageId: msg.id?._serialized,
    chatId: msg.id?.remote?._serialized,
    from: msg.from?._serialized || msg.id?.remote?._serialized,
    to: msg.to?._serialized,
    body: cleanBody,
    text: cleanBody,
    type: msg.type,
    timestamp: msg.t,
    fromMe: msg.id?.fromMe || false,
    author,
    media,
    ack: msg.ack,
    phoneNumber: getMyPhoneNumber(),
    pushname: msg.pushname || msg.sender?.pushname,
    notifyName: msg.sender?.pushname || msg.pushname,
    displayName:
      msg.sender?.displayName || msg.sender?.name || msg.sender?.formattedName || msg.pushname,
  };
}

async function processNewMessage(msg: any): Promise<void> {
  // Tipos de protocolo / notificación: no son chat de cliente
  const t = String(msg?.type || "").toLowerCase();
  if (
    [
      "notification",
      "notification_template",
      "e2e_notification",
      "gp2",
      "ciphertext",
      "protocol",
      "call_log",
      "revoked",
    ].includes(t)
  ) {
    return;
  }

  const fast = buildMessageFast(msg);
  if (isWhatsAppSystemText(fast.text || fast.body)) {
    console.warn("[EventEngine] skip system banner text");
    return;
  }

  // Resolver @lid → celular y foto ANTES de encolar el ingest.
  // Si WA no responde, se emite el @lid con phone vacío (nunca dígitos crudos).
  const identified = await applyIdentityToMessage(msg, fast).catch(() => undefined);
  const normalized = identified || fast;

  // Nunca automatizar chat consigo mismo
  const me = getMyPhoneNumber();
  const chatDigits = String(normalized.chatId || "").replace(/\D/g, "");
  if (me && chatDigits && me === chatDigits) {
    // Solo registrar saliente si quieres historial; no emitir NEW_MESSAGE
    if (!normalized.fromMe) {
      console.warn("[EventEngine] skip self-chat inbound", normalized.chatId);
      return;
    }
  }

  const eventType = normalized.fromMe ? "MESSAGE_SENT" : "NEW_MESSAGE";
  emit(eventType, normalized);
  const recovered = await enrichMessageInBackground(msg, normalized, eventType);
  if (!recovered && normalized.media?.missing_media) {
    scheduleMediaRetry(msg, normalized, eventType);
  }
}

async function enrichMessageInBackground(msg: any, base: any, eventType: WAEventType = "NEW_MESSAGE"): Promise<boolean> {
  const fromMe = !!msg.id?.fromMe;
  const WPP = getWPP();
  let realChatId = base.chatId;
  let realFrom = base.from;
  let realTo = base.to;
  let pushname = base.pushname;
  let notifyName = base.notifyName;
  let displayName = base.displayName;
  let profilePictureUrl: string | undefined;
  let media = base.media ? { ...base.media } : undefined;

  const hasMedia = !!media && !!(msg.isMedia || msg.mediaKey || msg.clientUrl || msg.deprecatedMms3Url || msg.mediaData);
  const isAudio = isAudioMessage(msg);
  // Audios entrantes: WhatsApp tarda más en desencriptar la nota de voz
  const waitMs =
    fromMe && hasMedia ? 3500 : isAudio && !fromMe ? 5000 : fromMe ? 1500 : 800;
  await new Promise((r) => setTimeout(r, waitMs));

  if (WPP) {
    if (realChatId?.endsWith("@lid")) {
      realChatId = (await resolveLidJid(WPP, realChatId)) ?? realChatId;
    }
    if (realFrom?.endsWith("@lid")) {
      realFrom = (await resolveLidJid(WPP, realFrom)) ?? realFrom;
    }
    if (realTo?.endsWith("@lid")) {
      realTo = (await resolveLidJid(WPP, realTo)) ?? realTo;
    }

    // El contacto relevante es el interlocutor (en salientes, el destinatario).
    const contactJid = fromMe ? realTo || realChatId : realFrom || realChatId;
    if (contactJid && !String(contactJid).endsWith("@g.us")) {
      try {
        const contactObj = await WPP.contact.get(contactJid);
        if (contactObj) {
          pushname = contactObj.pushname || pushname;
          notifyName = contactObj.pushname || notifyName;
          displayName =
            contactObj.name ||
            contactObj.displayName ||
            contactObj.pushname ||
            contactObj.formattedName ||
            displayName;
        }
        profilePictureUrl =
          (await fetchProfilePictureUrl(
            [contactJid, realChatId, base.chatId],
            contactObj,
          )) || profilePictureUrl;
      } catch {
        /* ignorar */
      }
    }
  }

  const hasMediaIndicators =
    msg.isMedia || msg.mediaKey || msg.clientUrl || msg.deprecatedMms3Url || msg.mediaData;
  if (media && hasMediaIndicators && media.missing_media) {
    media =
      (await downloadMessageMedia(msg, media, {
        // En background ya es seguro usar downloadMedia* (no bloquea WhatsApp)
        allowNativeDownload: true,
      })) ?? media;
  }

  const idsChanged =
    realChatId !== base.chatId || realFrom !== base.from || realTo !== base.to;
  const contactChanged =
    pushname !== base.pushname ||
    notifyName !== base.notifyName ||
    displayName !== base.displayName ||
    !!profilePictureUrl;
  const mediaRecovered = !!media?.base64 && base.media?.missing_media;

  const counterpartJid = String((fromMe ? realTo || realChatId : realFrom || realChatId) || "");
  const phoneFromResolved = sanitizePhoneForIngest(
    counterpartJid.endsWith("@lid") || counterpartJid.endsWith("@g.us") ? undefined : counterpartJid,
    counterpartJid,
    { verifiedCus: counterpartJid.endsWith("@c.us") || counterpartJid.endsWith("@s.whatsapp.net") },
  );
  const unresolvedWaId = canonicalWaId(counterpartJid) || canonicalWaId(base.chatId) || counterpartJid;

  const contactPayload = {
    waId: phoneFromResolved ? `${phoneFromResolved}@c.us` : unresolvedWaId,
    phone: phoneFromResolved,
    displayName: displayName || pushname || notifyName,
    profilePictureUrl,
  };

  // Reenviar si resolvimos LID→teléfono (aunque no haya media/nombre nuevo)
  const lidResolved =
    String(base.chatId || "").endsWith("@lid") &&
    String(realChatId || "").endsWith("@c.us");

  if (!idsChanged && !contactChanged && !mediaRecovered && !lidResolved) {
    return mediaRecovered;
  }

  // El reenvío del mensaje puede caer en el dedupe. CONTACT_INFO sí actualiza
  // teléfono y foto de la ficha (incluido el @lid original).
  if (phoneFromResolved || (profilePictureUrl && profilePictureUrl !== base.profilePictureUrl)) {
    const lidSource = [base.chatId, base.from, base.to].find(
      (jid) => typeof jid === "string" && jid.endsWith("@lid"),
    );
    const infoWaId = typeof lidSource === "string" ? canonicalWaId(lidSource) : contactPayload.waId;
    if (infoWaId) {
      emit("CONTACT_INFO", {
        ...ownAvatarPayload(),
        waId: infoWaId,
        chatId: infoWaId,
        phone: phoneFromResolved,
        displayName: contactPayload.displayName,
        pushname,
        profilePictureUrl,
      });
    }
  }

  emit(eventType, {
    ...base,
    ...ownAvatarPayload(),
    chatId: phoneFromResolved ? `${phoneFromResolved}@c.us` : canonicalWaId(realChatId) || realChatId,
    from: realFrom,
    to: realTo,
    pushname,
    notifyName,
    displayName,
    profilePictureUrl,
    contact: contactPayload,
    media,
    // Solo bytes/transcripción real bypass dedupe. LID→teléfono NO debe
    // re-disparar automatización (evita 2–4 respuestas al mismo mensaje).
    mediaRecovery: mediaRecovered || undefined,
    lidRecovery: lidResolved || undefined,
  });
  return mediaRecovered || lidResolved;
}

/** Reintento tardío de media (audios/imágenes) sin bloquear WhatsApp. */
function scheduleMediaRetry(msg: any, base: any, eventType: WAEventType): void {
  let completed = false;
  const isAudio = isAudioMessage(msg);
  const delays =
    isAudio && !base.fromMe
      ? [4000, 10000, 18000]
      : base.fromMe
        ? [6000, 12000]
        : [5000, 12000];
  for (const delayMs of delays) {
    setTimeout(() => {
      void (async () => {
        if (completed) return;
        const media = base.media ? { ...base.media, missing_media: true } : undefined;
        if (!media) return;
        let freshMsg = msg;
        const msgId = msg.id?._serialized || base.messageId;
        if (msgId) {
          try {
            freshMsg = (await getMessageById(msgId)) || msg;
          } catch {
            freshMsg = msg;
          }
        }
        const downloaded = await downloadMessageMedia(freshMsg, media, { allowNativeDownload: true });
        if (!downloaded?.base64) return;
        completed = true;
        emit(eventType, {
          ...base,
          media: downloaded,
          mediaRecovery: true,
        });
      })().catch(() => {});
    }, delayMs);
  }
}

async function resolveLidJid(WPP: any, jid: string): Promise<string | undefined> {
  if (!jid || typeof jid !== "string") return undefined;
  if (!jid.endsWith("@lid")) return canonicalWaId(jid) || jid;
  // WPP se lee dentro del resolver; el argumento se conserva para el caller histórico.
  void WPP;
  const phone = await resolveLidToPhoneDigits(jid);
  return phone ? `${phone}@c.us` : undefined;
}

async function downloadMessageMedia(
  msg: any,
  media: any,
  opts?: { allowNativeDownload?: boolean }
): Promise<any | null> {
  const isAudio = isAudioMessage(msg);
  const isVideo = msg.type === "video";
  const fromMe = fromMeSafe(msg);
  const maxRetries = isAudio ? 10 : isVideo ? 10 : fromMe ? 8 : 8;
  const retryDelayMs = isAudio ? 1200 : isVideo ? 2000 : 1500;
  // Sin allowNativeDownload: solo blob (audios, primer intento). Con allowNativeDownload: también downloadMedia*.
  const blobOnly = isAudio && !opts?.allowNativeDownload;

  try {
    const WPP = getWPP();
    let base64Data: string | null = null;
    let retries = maxRetries;
    const msgId = msg.id?._serialized || msg.id;

    const resolveValidCandidate = async (
      candidate: unknown,
      source: string,
    ): Promise<string | null> => {
      const resolved = await resolveToBase64(candidate, msg.mimetype);
      if (!resolved) return null;
      const validation = validateBase64Media(resolved);
      if (validation.valid) {
        // Quitar parámetros como `codecs=opus` del encabezado para mantener
        // compatibilidad con endpoints anteriores que esperan MIME simple.
        return resolved.replace(
          /^data:([^;,]+)(?:;[^,]*)?;base64,/i,
          "data:$1;base64,",
        );
      }
      if (isAudio) {
        console.warn("[MAPLE MULTIMEDIA] Fuente de audio todavía inválida", {
          messageId: msgId,
          source,
          firstBytes: validation.firstBytesHex,
        });
      }
      return null;
    };

    while (!base64Data && retries > 0) {
      // API pública documentada de WA-JS 4.5: requiere el ID serializado,
      // no el objeto del mensaje. Es la fuente principal para PTT entrantes.
      const wppMethod = WPP?.chat?.downloadMedia;
      if (typeof wppMethod === "function" && msgId) {
        try {
          const res = await wppMethod(msgId);
          base64Data = await resolveValidCandidate(res, "WPP.chat.downloadMedia(id)");
        } catch {
          /* WhatsApp puede no haber terminado de descargarlo; reintentar */
        }
      }

      const possibleUrls = [
        msg.clientUrl,
        msg.mediaData?.clientUrl,
        msg.mediaData?.renderableUrl,
        msg.mediaData?.previewUrl,
        msg.deprecatedMms3Url,
      ].filter((u): u is string => typeof u === "string" && u.startsWith("blob:"));

      for (const url of possibleUrls) {
        if (base64Data) break;
        try {
          const dataUri = await blobUrlToBase64(url);
          base64Data = await resolveValidCandidate(dataUri, "blobUrl");
          if (base64Data) break;
        } catch {
          /* ignorar */
        }
      }

      if (blobOnly && !opts?.allowNativeDownload) {
        retries--;
        if (retries > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }

      // Builds recientes de WA Web pueden exponer el Blob ya desencriptado
      // dentro de mediaData/_data aunque clientUrl todavía no exista.
      if (!base64Data) {
        const embeddedMedia = [
          msg.mediaData?.mediaBlob,
          msg.mediaData?.blob,
          msg._data?.mediaBlob,
          msg._data?.blob,
        ];
        for (const candidate of embeddedMedia) {
          if (!candidate) continue;
          try {
            base64Data = await resolveValidCandidate(candidate, "embeddedMedia");
            if (base64Data) break;
          } catch {
            /* probar siguiente fuente */
          }
        }
      }

      if (!base64Data && typeof msg.downloadMediaCrypted === "function") {
        try {
          const res = await msg.downloadMediaCrypted();
          base64Data = await resolveValidCandidate(res, "msg.downloadMediaCrypted");
        } catch {
          /* ignorar */
        }
      }

      if (!base64Data && typeof msg.downloadMedia === "function") {
        try {
          const res = await msg.downloadMedia();
          base64Data = await resolveValidCandidate(res, "msg.downloadMedia");
        } catch {
          /* ignorar */
        }
      }

      if (!base64Data && WPP?.chat) {
        const legacyWppMethod = WPP.chat.downloadMediaMessage;
        if (typeof legacyWppMethod === "function") {
          try {
            const res = await legacyWppMethod(msgId);
            base64Data = await resolveValidCandidate(
              res,
              "WPP.chat.downloadMediaMessage(id)",
            );
          } catch {
            /* ignorar */
          }
        }
      }

      if (base64Data) {
        const validation = validateBase64Media(base64Data);
        if (!validation.valid) {
          if (isAudio) {
            console.warn("[MAPLE MULTIMEDIA] Candidato de audio inválido; se reintentará", {
              messageId: msg.id?._serialized || msg.id,
              firstBytes: validation.firstBytesHex,
              detectedType: validation.detectedType,
            });
          }
          base64Data = null;
        } else {
          const approxBytes = Math.ceil(base64Data.length * 0.75);
          if (approxBytes <= 20 * 1024 * 1024) {
            const mime =
              validation.detectedType !== "unknown/encrypted"
                ? validation.detectedType
                : msg.mimetype || media.mimetype || (isAudio ? "audio/ogg" : undefined);
            return {
              ...media,
              base64: base64Data,
              type: msg.type,
              mimetype: mime,
              mimeType: mime,
              missing_media: false,
            };
          }
          return media;
        }
      }

      retries--;
      if (retries > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  } catch (err) {
    console.warn("[MAPLE MULTIMEDIA] Error descargando media en background:", err);
  }

  if (isAudio) {
    console.warn("[MAPLE MULTIMEDIA] Audio no recuperado tras reintentos", {
      messageId: msg.id?._serialized || msg.id,
      type: msg.type,
      mimetype: msg.mimetype,
      hasClientUrl: !!msg.clientUrl,
      hasMediaData: !!msg.mediaData,
      hasDownloadMedia: typeof msg.downloadMedia === "function",
      hasDownloadMediaCrypted: typeof msg.downloadMediaCrypted === "function",
    });
  }
  return null;
}

function fromMeSafe(msg: any): boolean {
  return !!msg?.id?.fromMe;
}

function normalizeChat(chat: any): any {
  let id = chat.id;
  if (typeof id === "string") {
    id = { _serialized: id, server: id.split("@")[1], user: id.split("@")[0] };
  }

  return {
    chatId: id?._serialized,
    user: id?.user,
    server: id?.server,
    name: chat.name || chat.formattedTitle || chat.contact?.displayName || "",
    isGroup: id?.server === "g.us",
    canSend: chat.canSend ?? true,
    unreadCount: chat.unreadCount || 0,
    labels: chat.labels || [],
    timestamp: chat.t,
  };
}

function extractMediaData(msg: any): any {
  if (!["image", "video", "audio", "ptt", "document"].includes(msg.type)) {
    return undefined;
  }
  return {
    type: msg.type,
    mimetype: msg.mimetype,
    filehash: msg.filehash,
    mediaKey: msg.mediaKey,
    size: msg.size,
    duration: msg.duration,
    caption: msg.caption,
  };
}

export function destroyEventEngine(): void {
  for (const fn of cleanupFns) {
    try { fn(); } catch (e) {}
  }
  cleanupFns = [];
  listenersInitialized = false;
}

// ============================================================
// MAPLE WA ENGINE — Contact Enricher (LID → Phone resolver)
// Apéndice añadido para resolver números reales y enriquecer
// los contactos con foto de perfil, nombre y teléfono.
// ============================================================
(function(){
  if (window.__MAPLE_CONTACT_ENRICHER_LOADED) return;
  window.__MAPLE_CONTACT_ENRICHER_LOADED = true;

  const SENT_CACHE = new Map();  // waId -> timestamp last emit
  const COMPLETE_CACHE = new Map(); // waId -> ficha con teléfono (si aplica) y foto

  function digitsOnly(v: any): string | null {
    if (v == null) return null;
    const s = String(v).split('@')[0].replace(/\D/g, '');
    return s || null;
  }

  async function resolveLidToPhone(lid: string): Promise<string | null> {
    return resolveLidToPhoneDigits(lid);
  }

  async function getProfilePicUrl(waId: string, contact?: any): Promise<string | null> {
    const phone = waId.endsWith("@lid") ? await resolveLidToPhone(waId) : sanitizePhoneForIngest(waId, waId, { verifiedCus: waId.endsWith("@c.us") });
    const url = await fetchProfilePictureUrl(
      [phone ? `${phone}@c.us` : undefined, phone ? `${phone}@s.whatsapp.net` : undefined, waId],
      contact,
    );
    return url || null;
  }

  function pickDisplayName(contact: any, chat: any, phone: string | null, cid: string): string | null {
    const candidates = [
      contact?.name,
      contact?.verifiedName,
      contact?.displayName,
      contact?.pushname,
      contact?.formattedName,
      contact?.notifyName,
      chat?.name,
      chat?.formattedTitle,
      chat?.contact?.name,
      chat?.contact?.pushname,
    ];
    for (const raw of candidates) {
      if (typeof raw !== 'string') continue;
      const n = raw.trim();
      if (!n) continue;
      if (/^cliente\s*\d+/i.test(n)) continue;
      if (n.toLowerCase() === 'unknown') continue;
      const digits = n.replace(/\D/g, '');
      if (cid.endsWith('@lid') && digits && digits === digitsOnly(cid)) continue;
      if (phone && digits === phone && n.replace(/\D/g, '') === phone && !/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(n)) {
        // Solo dígitos: preferir nombre real si aparece después; aún así sirve como fallback
        continue;
      }
      return n;
    }
    return phone ? `+${phone}` : null;
  }

  function emit(event: string, payload: any): void {
    try {
      window.postMessage({
        source: 'MAPLE_WA_INJECTED',
        direction: 'INJECTED_TO_CONTENT',
        channel: 'WA_EVENT',
        id: `${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
        event,
        payload
      }, 'https://web.whatsapp.com');
    } catch(e){}
  }

  async function enrichChat(chat: any, force = false): Promise<void> {
    try {
      const cid = chat?.id?._serialized || (typeof chat?.id === 'string' ? chat.id : null);
      if (!cid || typeof cid !== 'string') return;
      if (cid.endsWith('@g.us')) return;       // skip grupos

      // Ficha completa: no repetir en 1 h. LID sin celular o sin foto: reintentar a los 3 min.
      const last = SENT_CACHE.get(cid) || 0;
      const complete = COMPLETE_CACHE.get(cid) === true;
      if (!force && last && Date.now() - last < (complete ? 60 * 60 * 1000 : 3 * 60 * 1000)) return;

      let phone: string | null = null;
      if (cid.endsWith('@lid')) {
        phone = await resolveLidToPhone(cid);
      } else if (cid.endsWith('@c.us')) {
        phone = sanitizePhoneForIngest(cid, cid, { verifiedCus: true }) || null;
      }

      const contact = (chat.contact) || (await (window as any).WPP.contact.get(cid).catch(()=>null));
      const displayName = pickDisplayName(contact, chat, phone, cid);
      const pushname = contact?.pushname || contact?.notifyName || null;
      const pic = await getProfilePicUrl(phone ? `${phone}@c.us` : cid, contact);
      // La ficha LID se actualiza por su @lid; el celular va aparte (no como +1…).
      const waId = cid.endsWith("@lid")
        ? canonicalWaId(cid)
        : phone
          ? `${phone}@c.us`
          : canonicalWaId(cid);

      // Sin nombre ni teléfono ni foto: no ensuciar el CRM
      if (!phone && !displayName && !pic) return;
      if (!waId) return;

      const incomplete = (cid.endsWith("@lid") && !phone) || !pic;
      COMPLETE_CACHE.set(cid, !incomplete);
      SENT_CACHE.set(cid, Date.now());

      emit('CONTACT_INFO', {
        ...ownAvatarPayload(),
        waId,
        chatId: waId,
        phone: phone || undefined,
        displayName,
        pushname,
        profilePictureUrl: pic,
        isGroup: false,
      });
    } catch(e){
      console.warn('[MAPLE ENRICHER] enrichChat error:', e);
    }
  }

  async function enrichAll(): Promise<void> {
    const WPP = (window as any).WPP;
    if (!WPP || !WPP.chat) return;
    try {
      const chats = await WPP.chat.list();
      let i = 0;
      for (const chat of chats) {
        await enrichChat(chat);
        if (++i % 5 === 0) await new Promise(r => setTimeout(r, 150));
      }
      console.log('[MAPLE ENRICHER] Procesados', chats.length, 'chats');
    } catch(e){
      console.warn('[MAPLE ENRICHER] enrichAll error:', e);
    }
  }

  // Espera a WPP y arranca
  (async function start(){
    let tries = 0;
    while (!(window as any).WPP && tries < 300) {
      await new Promise(r => setTimeout(r, 200));
      tries++;
    }
    if (!(window as any).WPP) {
      console.warn('[MAPLE ENRICHER] WPP no disponible, abortando');
      return;
    }

    // Primer barrido a los 10s para dar tiempo al engine principal
    setTimeout(enrichAll, 10000);
    // Re-barrido cada 5 min
    setInterval(enrichAll, 5 * 60 * 1000);

    // Enriquecer contactos entrantes en background (nunca bloquear salientes ni el pipeline de WA)
    try {
      (window as any).WPP.on?.('chat.new_message', (msg: any) => {
        if (msg?.id?.fromMe) return;
        setTimeout(() => {
          void (async () => {
            try {
              const cid = msg?.id?.remote?._serialized
                || msg?.from?._serialized
                || msg?.chatId;
              if (!cid || cid.endsWith('@g.us')) return;
              SENT_CACHE.delete(cid);
              const chat = await (window as any).WPP.chat.find(cid).catch(()=>null);
              await enrichChat(chat || { id: { _serialized: cid } });
            } catch(e){}
          })();
        }, 8000);
      });
    } catch(e){}

    console.log('[MAPLE ENRICHER] Contact enricher activo');
  })();

  // Expose for debugging
  (window as any).__MAPLE_RESOLVE_LID = resolveLidToPhone;
  (window as any).__MAPLE_ENRICH_ALL = enrichAll;
})();
