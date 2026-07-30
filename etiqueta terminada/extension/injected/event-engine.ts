// ============================================================
// MAPLE WA ENGINE — Event Engine (Injected Script)
// Registra todos los listeners de WPP y los reenvía al bridge
// ============================================================

import { waitForWPP, getWPP } from "./wpp-bootstrap";
import { getMessageById } from "./message-detector";
import { postFromInjected } from "../bridge/postmessage";
import type { WAEventType } from "../shared/types";
import { sanitizeMessageBody, isWhatsAppSystemText } from "../shared/message-text";

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
    const clean = base64Data.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
    if (clean.length < 8) return { valid: false, firstBytesHex: "too_short", detectedType: "unknown" };

    const binary = atob(clean);
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

function createWidSafely(WPP: any, jid: string): any {
  try {
    if (WPP.whatsapp?.createWid) return WPP.whatsapp.createWid(jid);
    if (WPP.whatsapp?.WidFactory?.createWid) return WPP.whatsapp.WidFactory.createWid(jid);
    if (WPP.whatsapp?.Wid?.create) return WPP.whatsapp.Wid.create(jid);
    // Fallback: construir manualmente el objeto Wid mínimo
    const [user, server] = jid.split("@");
    return { user, server, _serialized: jid };
  } catch (e) {
    return null;
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
  if (typeof data === "string") return data || null;

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
      : new Uint8Array((data as ArrayBufferView).buffer);
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

  const normalized = buildMessageFast(msg);
  if (isWhatsAppSystemText(normalized.text || normalized.body)) {
    console.warn("[EventEngine] skip system banner text");
    return;
  }

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
    fromMe && hasMedia ? 3500 : isAudio && !fromMe ? 3500 : fromMe ? 1500 : 800;
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

    // En salientes el contacto relevante es el destinatario (to), no nosotros
    const contactJid = fromMe ? realTo || realChatId : realFrom || realChatId;
    if (contactJid && !fromMe) {
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
          profilePictureUrl =
            contactObj.profilePicThumb?.imgFull ||
            contactObj.profilePicThumb?.img ||
            contactObj.profilePictureThumb ||
            contactObj.profilePicThumbObj?.eurl ||
            undefined;
          if (!profilePictureUrl && typeof WPP.contact.getProfilePictureUrl === "function") {
            try {
              const picUrl = await WPP.contact.getProfilePictureUrl(contactJid);
              if (typeof picUrl === "string" && picUrl.startsWith("http")) {
                profilePictureUrl = picUrl;
              }
            } catch {
              /* ignorar */
            }
          }
        }
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

  const phoneFromResolved = (() => {
    const jid = fromMe ? realTo || realChatId : realFrom || realChatId;
    if (!jid || typeof jid !== "string" || jid.endsWith("@lid") || jid.endsWith("@g.us")) {
      return undefined;
    }
    const d = jid.split("@")[0].replace(/\D/g, "");
    return d.length >= 8 && d.length <= 15 ? d : undefined;
  })();

  const contactPayload = {
    waId: phoneFromResolved
      ? `${phoneFromResolved}@c.us`
      : String((fromMe ? realTo || realChatId : realFrom || realChatId) || base.chatId || ""),
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

  emit(eventType, {
    ...base,
    chatId: phoneFromResolved ? `${phoneFromResolved}@c.us` : realChatId,
    from: realFrom,
    to: realTo,
    pushname,
    notifyName,
    displayName,
    profilePictureUrl,
    contact: contactPayload,
    media,
    mediaRecovery: mediaRecovered || lidResolved || undefined,
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
  if (!jid.endsWith("@lid")) return jid;

  const digitsOnly = (v: any): string | null => {
    if (v == null) return null;
    const s = String(v).split("@")[0].replace(/\D/g, "");
    return s || null;
  };
  const looksLikePhone = (d: string | null) =>
    !!d && d.length >= 8 && d.length <= 15;

  let phone: string | null = null;

  // 1) ApiContact.getPhoneNumber
  try {
    const wid = createWidSafely(WPP, jid);
    if (wid && WPP.whatsapp?.ApiContact?.getPhoneNumber) {
      const numObj = await WPP.whatsapp.ApiContact.getPhoneNumber(wid);
      const d = digitsOnly(numObj?._serialized || numObj?.user || numObj);
      if (looksLikePhone(d)) phone = d;
    }
  } catch {
    /* ignore */
  }

  // 2) contact.get — campos phoneNumber / phone / wid
  if (!phone) {
    try {
      const c = await WPP.contact?.get?.(jid);
      const candidates = [
        c?.phoneNumber?._serialized,
        c?.phoneNumber?.user,
        c?.phoneNumber,
        c?.phone?._serialized,
        c?.phone?.user,
        c?.phone,
        c?.id?._serialized,
        c?.wid?._serialized,
        c?.wid?.user,
      ];
      for (const x of candidates) {
        const d = digitsOnly(x);
        // Evitar devolver el propio LID numérico como "teléfono"
        if (looksLikePhone(d) && !String(x || "").includes("@lid")) {
          phone = d;
          break;
        }
        if (looksLikePhone(d) && typeof x === "string" && x.includes("@c.us")) {
          phone = d;
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 3) LidToPnMap / LidUtils
  if (!phone) {
    try {
      const map =
        WPP.whatsapp?.LidToPnMap ||
        WPP.whatsapp?.LidUtils ||
        WPP.whatsapp?.LidPnMap ||
        WPP.whatsapp?.SignalDeviceLidPnMap;
      const fnName = ["findPnForLid", "getPhoneNumber", "getPn", "getPhoneForLid", "lidToPn"].find(
        (n) => map && typeof map[n] === "function",
      );
      if (fnName) {
        const pn = await (map as any)[fnName](jid);
        const d = digitsOnly(pn?._serialized || pn?.user || pn);
        if (looksLikePhone(d)) phone = d;
      }
    } catch {
      /* ignore */
    }
  }

  // 4) queryExists
  if (!phone) {
    try {
      const r = await WPP.contact?.queryExists?.(jid);
      const widSer = r?.wid?._serialized || r?.wid?.user || r?.wid || r;
      if (typeof widSer === "string" && widSer.includes("@c.us")) {
        const d = digitsOnly(widSer);
        if (looksLikePhone(d)) phone = d;
      }
    } catch {
      /* ignore */
    }
  }

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

    while (!base64Data && retries > 0) {
      const possibleUrls = [
        msg.clientUrl,
        msg.mediaData?.clientUrl,
        msg.mediaData?.renderableUrl,
        msg.mediaData?.previewUrl,
        msg.deprecatedMms3Url,
      ].filter((u): u is string => typeof u === "string" && u.startsWith("blob:"));

      for (const url of possibleUrls) {
        try {
          base64Data = await blobUrlToBase64(url);
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

      if (!base64Data && typeof msg.downloadMediaCrypted === "function") {
        try {
          const res = await msg.downloadMediaCrypted();
          base64Data = await resolveToBase64(res, msg.mimetype);
        } catch {
          /* ignorar */
        }
      }

      if (!base64Data && typeof msg.downloadMedia === "function") {
        try {
          const res = await msg.downloadMedia();
          base64Data = await resolveToBase64(res, msg.mimetype);
        } catch {
          /* ignorar */
        }
      }

      if (!base64Data && WPP?.chat) {
        const wppMethod = WPP.chat.downloadMedia || WPP.chat.downloadMediaMessage;
        if (typeof wppMethod === "function") {
          try {
            const msgId = msg.id?._serialized || msg.id;
            let res: any;
            try {
              res = await wppMethod(msg);
            } catch {
              res = await wppMethod(msgId);
            }
            base64Data = await resolveToBase64(res, msg.mimetype);
          } catch {
            /* ignorar */
          }
        }
      }

      if (base64Data) {
        const validation = validateBase64Media(base64Data);
        const isAudioMsg = isAudioMessage(msg);
        if (!validation.valid && !isAudioMsg) {
          base64Data = null;
        } else {
          const approxBytes = Math.ceil(base64Data.length * 0.75);
          if (approxBytes <= 20 * 1024 * 1024) {
            const mime = msg.mimetype || media.mimetype || (isAudioMsg ? "audio/ogg" : undefined);
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

  const LID_CACHE = new Map();   // waId(lid) -> phone(digits)
  const SENT_CACHE = new Map();  // waId -> timestamp last emit
  const MIN_PHONE_LEN = 8;
  const MAX_PHONE_LEN = 15;

  function digitsOnly(v: any): string | null {
    if (v == null) return null;
    const s = String(v).split('@')[0].replace(/\D/g, '');
    return s || null;
  }

  function looksLikePhone(d: string | null): boolean {
    return !!d && d.length >= MIN_PHONE_LEN && d.length <= MAX_PHONE_LEN;
  }

  async function resolveLidToPhone(lid: string): Promise<string | null> {
    if (!lid || typeof lid !== 'string') return null;
    if (!lid.endsWith('@lid')) {
      const d = digitsOnly(lid);
      return looksLikePhone(d) ? d : null;
    }
    if (LID_CACHE.has(lid)) return LID_CACHE.get(lid) || null;

    const WPP = (window as any).WPP;
    if (!WPP) return null;
    let phone: string | null = null;

    // Estrategia 1: contact.get(lid) y revisar todos los campos posibles
    try {
      const c = await WPP.contact.get(lid);
      const candidates = [
        c?.phoneNumber?._serialized, c?.phoneNumber?.user, c?.phoneNumber,
        c?.phone?._serialized, c?.phone?.user, c?.phone,
        c?.id?._serialized, c?.wid?._serialized, c?.wid?.user,
      ];
      for (const x of candidates) {
        const d = digitsOnly(x);
        if (looksLikePhone(d)) { phone = d; break; }
      }
    } catch(e){}

    // Estrategia 2: WidFactory + ApiContact.getPhoneNumber
    if (!phone) {
      try {
        const wf = WPP.whatsapp?.WidFactory?.createWid || WPP.whatsapp?.createWid;
        const Wid = wf ? wf(lid) : null;
        if (Wid && WPP.whatsapp?.ApiContact?.getPhoneNumber) {
          const pn = await WPP.whatsapp.ApiContact.getPhoneNumber(Wid);
          const d = digitsOnly(pn?._serialized || pn?.user || pn);
          if (looksLikePhone(d)) phone = d;
        }
      } catch(e){}
    }

    // Estrategia 3: LidToPnMap / LidUtils (WA-JS modernos)
    if (!phone) {
      try {
        const map = WPP.whatsapp?.LidToPnMap || WPP.whatsapp?.LidUtils
          || WPP.whatsapp?.LidPnMap || WPP.whatsapp?.SignalDeviceLidPnMap;
        const fnName = ['findPnForLid','getPhoneNumber','getPn','getPhoneForLid','lidToPn']
          .find(n => map && typeof map[n] === 'function');
        if (fnName) {
          const pn = await (map as any)[fnName](lid);
          const d = digitsOnly(pn?._serialized || pn?.user || pn);
          if (looksLikePhone(d)) phone = d;
        }
      } catch(e){}
    }

    // Estrategia 4: queryExists
    if (!phone) {
      try {
        const r = await WPP.contact?.queryExists?.(lid);
        const d = digitsOnly(r?.wid?._serialized || r?.wid?.user || r?.wid || r);
        if (looksLikePhone(d)) phone = d;
      } catch(e){}
    }

    if (phone) LID_CACHE.set(lid, phone);
    return phone;
  }

  async function getProfilePicUrl(waId: string): Promise<string | null> {
    try {
      const url = await (window as any).WPP?.contact?.getProfilePictureUrl?.(waId);
      if (typeof url === 'string' && url.startsWith('http')) return url;
    } catch(e){}
    return null;
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

  async function enrichChat(chat: any): Promise<void> {
    try {
      const cid = chat?.id?._serialized || (typeof chat?.id === 'string' ? chat.id : null);
      if (!cid || typeof cid !== 'string') return;
      if (cid.endsWith('@g.us')) return;       // skip grupos

      // Throttling: no reemitir el mismo waId en menos de 60 minutos
      const last = SENT_CACHE.get(cid) || 0;
      if (Date.now() - last < 60 * 60 * 1000) return;

      let phone: string | null = null;
      if (cid.endsWith('@lid')) {
        phone = await resolveLidToPhone(cid);
      } else if (cid.endsWith('@c.us')) {
        phone = digitsOnly(cid);
      }

      const contact = (chat.contact) || (await (window as any).WPP.contact.get(cid).catch(()=>null));
      const displayName = contact?.name || contact?.displayName
        || contact?.pushname || contact?.formattedName
        || chat.name || chat.formattedTitle || null;
      const pushname = contact?.pushname || null;
      const pic = await getProfilePicUrl(cid);

      SENT_CACHE.set(cid, Date.now());

      emit('CONTACT_INFO', {
        waId: cid,
        phone,
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
