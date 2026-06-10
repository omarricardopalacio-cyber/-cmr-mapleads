// ============================================================
// MAPLE WA ENGINE — Event Engine (Injected Script)
// Registra todos los listeners de WPP y los reenvía al bridge
// ============================================================

import { waitForWPP, getWPP } from "./wpp-bootstrap";
import { postFromInjected } from "../bridge/postmessage";
import type { WAEventType } from "../shared/types";
import { isBase64Thumbnail, sanitizeMessageBody } from "../shared/message-text";

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

    return { valid: false, firstBytesHex: hex, detectedType: "unknown/encrypted" };
  } catch (e) {
    return { valid: false, firstBytesHex: "decode_error", detectedType: "error" };
  }
}

function registerNewMessage(WPP: NonNullable<typeof window.WPP>): void {
  const handler = async (...args: any[]) => {
    const msg = args[0];
    if (!msg) return;

    try {
      const normalized = await normalizeMessage(msg);
      if (!normalized) return;
      emit("NEW_MESSAGE", normalized);
    } catch (err) {
      console.error("[EventEngine] Error normalizando mensaje:", err);
    }
  };

  if (typeof WPP.prependListener === "function") {
    WPP.prependListener("chat.new_message", handler, { objectify: true });
  } else if (typeof WPP.on === "function") {
    console.warn("[EventEngine] WPP.prependListener no disponible, usando on() para chat.new_message");
    (WPP as any).on("chat.new_message", handler, { objectify: true });
  } else {
    console.warn("[EventEngine] WPP no soporta prependListener ni on para chat.new_message");
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
    if (me?.user) return me.user;
    const conn = WPP.whatsapp?.Stream?.get?.();
    if (conn?.wid?.user) return conn.wid.user;
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

async function normalizeMessage(msg: any): Promise<any> {
  // DIAGNÓSTICO: Loguear TODO mensaje entrante para ver propiedades
  console.log("[MAPLE EVENT ENGINE] normalizeMessage llamado:", {
    id: msg.id?._serialized,
    type: msg.type,
    isMedia: msg.isMedia,
    hasMediaKey: !!msg.mediaKey,
    hasClientUrl: !!msg.clientUrl,
    hasDeprecatedMms3Url: !!msg.deprecatedMms3Url,
    hasBody: !!msg.body,
    bodyPreview: msg.body ? String(msg.body).substring(0, 60) : null,
    keys: Object.keys(msg).filter(k => k.includes("media") || k.includes("url") || k.includes("blob")),
  });

  let author: any = undefined;
  if (msg.__x_author) {
    author = {
      device: msg.__x_author.device,
      server: msg.__x_author.server,
      user: msg.__x_author.user,
      serialized: msg.__x_author._serialized,
    };
  }

  const phoneNumber = getMyPhoneNumber();

  const media = extractMediaData(msg);

  // Detección robusta de media: usar múltiples propiedades porque msg.isMedia puede ser undefined
  const hasMediaIndicators = msg.isMedia || msg.mediaKey || msg.clientUrl || msg.deprecatedMms3Url || msg.mediaData;
  const shouldDownloadMedia = hasMediaIndicators && media;

  console.log("[MAPLE EVENT ENGINE] Decisión media:", {
    hasMediaIndicators,
    shouldDownloadMedia,
    mediaExtracted: !!media,
    msgType: msg.type,
  });

  // Descargar media binaria para mensajes multimedia (entrantes y salientes) con reintentos
  if (shouldDownloadMedia) {
    // DIAGNÓSTICO: Loguear estado inicial del media
    console.log("[MAPLE MULTIMEDIA] Mensaje multimedia detectado:", {
      type: msg.type,
      isMedia: msg.isMedia,
      id: msg.id?._serialized,
      hasMediaData: !!msg.mediaData,
      hasClientUrl: !!msg.clientUrl,
      hasDeprecatedMms3Url: !!msg.deprecatedMms3Url,
      hasDownloadMedia: typeof msg.downloadMedia === "function",
      hasDownloadMediaCrypted: typeof msg.downloadMediaCrypted === "function",
      mediaDataKeys: msg.mediaData ? Object.keys(msg.mediaData) : [],
    });

    try {
      const WPP = getWPP();
      let base64Data: string | null = null;
      const isVideo = msg.type === "video";
      let retries = isVideo ? 12 : 12; // Aumentado a 12 para imágenes también - más tiempo para descarga

      while (!base64Data && retries > 0) {
        // Método 1: Intentar leer del blob URL nativo que WhatsApp ya descargó en el navegador (debe ser blob:)
        const possibleUrls = [
          msg.clientUrl,
          msg.mediaData?.clientUrl,
          msg.mediaData?.renderableUrl,
          msg.mediaData?.previewUrl,
          msg.deprecatedMms3Url,
        ].filter((u): u is string => typeof u === "string" && u.startsWith("blob:"));

        for (const url of possibleUrls) {
          console.log("[MAPLE MULTIMEDIA] Intentando extraer desde URL:", url.substring(0, 60) + "...");
          try {
            if (url.startsWith("blob:")) {
              base64Data = await blobUrlToBase64(url);
            } else {
              // Sin credentials explícito para evitar CORS wildcard + credentials:include rejection
              const resp = await fetch(url);
              if (resp.ok) {
                const blob = await resp.blob();
                base64Data = await new Promise<string | null>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result as string);
                  reader.onerror = () => reject(reader.error);
                  reader.readAsDataURL(blob);
                });
              }
            }
            if (base64Data) {
              console.log("[MAPLE MULTIMEDIA] Sincronización exitosa desde URL!");
              break;
            }
          } catch (urlErr) {
            console.warn("[MAPLE MULTIMEDIA] Fallo URL:", url.substring(0, 40), urlErr);
          }
        }

        // Método 2: Descarga encriptada nativa (más confiable para media entrante)
        if (!base64Data && typeof msg.downloadMediaCrypted === "function") {
          console.log("[MAPLE MULTIMEDIA] Intentando descargar vía msg.downloadMediaCrypted()...");
          try {
            const res = await msg.downloadMediaCrypted();
            console.log("[MAPLE MULTIMEDIA] downloadMediaCrypted result:", typeof res, res?.constructor?.name, Object.keys(res || {}));
            // FIX: usar resolveToBase64 en lugar de manejar solo string/data
            base64Data = await resolveToBase64(res, msg.mimetype);
          } catch (e: any) {
            console.warn("[MAPLE MULTIMEDIA] downloadMediaCrypted failed:", e?.message || e);
          }
        }

        // Método 3: Descarga directa desde el modelo de mensaje
        if (!base64Data && typeof msg.downloadMedia === "function") {
          console.log("[MAPLE MULTIMEDIA] Intentando descargar vía msg.downloadMedia()...");
          try {
            const res = await msg.downloadMedia();
            console.log("[MAPLE MULTIMEDIA] msg.downloadMedia result:", typeof res, res?.constructor?.name);
            // FIX: usar resolveToBase64 en lugar de manejar solo string/data
            base64Data = await resolveToBase64(res, msg.mimetype);
          } catch (e: any) {
            console.warn("[MAPLE MULTIMEDIA] msg.downloadMedia failed:", e?.message || e);
          }
        }

        // Método 4: Usar API nativa de descarga de WPP
        // FIX: intentar primero con el objeto msg completo, luego con el ID serializado
        // (algunas versiones de WPP requieren el objeto completo, no solo el ID)
        if (!base64Data && WPP && WPP.chat) {
          const wppMethod = WPP.chat.downloadMedia || WPP.chat.downloadMediaMessage;
          if (typeof wppMethod === "function") {
            console.log("[MAPLE MULTIMEDIA] Intentando descargar vía WPP...");
            try {
              const msgId = msg.id?._serialized || msg.id;
              let res: any;
              try {
                res = await wppMethod(msg);         // FIX: objeto completo primero
              } catch {
                res = await wppMethod(msgId);       // fallback: solo el ID
              }
              console.log("[MAPLE MULTIMEDIA] WPP result:", typeof res, res?.constructor?.name, JSON.stringify(res)?.substring(0, 200));
              // FIX: usar resolveToBase64 para manejar Blob, ArrayBuffer, string, etc.
              const resolved = await resolveToBase64(res, msg.mimetype);
              if (resolved) {
                base64Data = resolved;
              } else if (res?.size === 0 || res?._blob?.size === 0) {
                console.warn("[MAPLE MULTIMEDIA] WPP devolvió Blob vacío, reintentando...");
              }
            } catch (e: any) {
              console.warn("[MAPLE MULTIMEDIA] WPP download failed:", e?.message || e);
            }
          } else {
            console.warn("[MAPLE MULTIMEDIA] WPP.chat.downloadMedia no disponible");
          }
        }

        if (base64Data) {
          const validation = validateBase64Media(base64Data);
          console.log("[MAPLE MULTIMEDIA] Base64 validación:", {
            valid: validation.valid,
            detectedType: validation.detectedType,
            firstBytes: validation.firstBytesHex,
            length: base64Data.length,
            approxBytes: Math.ceil(base64Data.length * 0.75),
          });

          if (!validation.valid) {
            console.warn("[MAPLE MULTIMEDIA] Base64 NO es una imagen válida. Probablemente datos encriptados o corruptos. Reintentando...");
            base64Data = null; // Forzar reintento con otro método
          } else {
            const approxBytes = Math.ceil(base64Data.length * 0.75);
            if (approxBytes > 20 * 1024 * 1024) {
              console.warn(
                "[MAPLE MULTIMEDIA] Archivo > 20MB; se enviará solo metadata (evita timeout en servidor)"
              );
            } else {
              media.base64 = base64Data;
              media.type = msg.type;
            }
            break;
          }
        }

        retries--;
        if (retries > 0) {
          console.log(`[MAPLE MULTIMEDIA] Archivo no listo aún. Esperando 2.5s antes del reintento... (${retries} intentos restantes)`);
          await new Promise((r) => setTimeout(r, isVideo ? 3000 : 2500));
        }
      }

      if (!base64Data) {
        // FIX CRÍTICO: En lugar de devolver null (que silencia el mensaje completamente),
        // marcamos el media como faltante y CONTINUAMOS enviando el evento al CRM.
        // Así el CRM recibe la notificación de que llegó un mensaje con imagen,
        // aunque todavía no tenga el base64. Esto es lo que hace la versión funcional.
        console.warn("[MAPLE MULTIMEDIA] No se pudo obtener la multimedia tras reintentos para el mensaje:", msg.id?._serialized);
        console.log("[MAPLE MULTIMEDIA] Enviando evento con missing_media=true para que el CRM lo reciba igualmente");
        if (media) {
          media.missing_media = true;
          media.extraction_error = "timeout_after_retries";
        }
      }
    } catch (err) {
      console.error("[MAPLE MULTIMEDIA] Error general descargando media:", err);
      console.log("[MAPLE MULTIMEDIA] Enviando evento con missing_media=true (error en descarga)");
      if (media) {
        media.missing_media = true;
        media.extraction_error = "exception_during_download";
      }
    }
  }

  const cleanBody = sanitizeMessageBody({
    body: msg.body,
    caption: msg.caption,
    isMedia: msg.isMedia,
    type: msg.type,
  });

  if (msg.isMedia && isBase64Thumbnail(msg.body)) {
    console.log(
      `[MAPLE EVENT ENGINE] Filtrado thumbnail base64 en body para mensaje ${msg.id?._serialized}. Usando caption.`
    );
  }

  const WPP = getWPP();
  let realChatId = msg.id?.remote?._serialized;
  let realFrom = msg.from?._serialized || msg.id?.remote?._serialized;
  let realTo = msg.to?._serialized;

  // Si son JIDs de tipo LID, resolver su número telefónico real (@c.us) para evitar duplicación y chats "sin número"
  if (WPP) {
    if (realChatId && realChatId.endsWith("@lid")) {
      try {
        const wid = createWidSafely(WPP, realChatId);
        if (!wid) {
          console.warn("[EventEngine] No se pudo crear Wid para:", realChatId);
        } else {
          const numObj = await WPP.whatsapp.ApiContact.getPhoneNumber(wid);
          if (numObj && numObj._serialized) {
            realChatId = numObj._serialized;
          }
        }
      } catch (err) {
        console.warn("[EventEngine] Error al obtener número para LID chatId:", realChatId, err);
      }
    }
    if (realFrom && realFrom.endsWith("@lid")) {
      try {
        const wid = createWidSafely(WPP, realFrom);
        if (!wid) {
          console.warn("[EventEngine] No se pudo crear Wid para:", realFrom);
        } else {
          const numObj = await WPP.whatsapp.ApiContact.getPhoneNumber(wid);
          if (numObj && numObj._serialized) {
            realFrom = numObj._serialized;
          }
        }
      } catch (err) {}
    }
    if (realTo && realTo.endsWith("@lid")) {
      try {
        const wid = createWidSafely(WPP, realTo);
        if (!wid) {
          console.warn("[EventEngine] No se pudo crear Wid para:", realTo);
        } else {
          const numObj = await WPP.whatsapp.ApiContact.getPhoneNumber(wid);
          if (numObj && numObj._serialized) {
            realTo = numObj._serialized;
          }
        }
      } catch (err) {}
    }
  }

  // Extraer información de contacto/nombre del remitente si está disponible
  let pushname = msg.pushname || msg.sender?.pushname || undefined;
  let notifyName = msg.sender?.pushname || msg.pushname || undefined;
  let displayName = msg.sender?.displayName || msg.sender?.name || msg.sender?.formattedName || pushname || undefined;

  // Si no hay nombre y tenemos el contacto de WPP, cargarlo
  let profilePictureUrl: string | undefined = undefined;
  if (WPP && realFrom) {
    try {
      const contactObj = await WPP.contact.get(realFrom);
      if (contactObj) {
        pushname = contactObj.pushname || pushname;
        notifyName = contactObj.pushname || notifyName;
        displayName = contactObj.name || contactObj.displayName || contactObj.pushname || contactObj.formattedName || undefined;
        
        // Extraer foto de perfil si está disponible en el objeto contacto
        if (contactObj.profilePicThumb?.imgFull || contactObj.profilePicThumb?.img) {
          profilePictureUrl = contactObj.profilePicThumb.imgFull || contactObj.profilePicThumb.img || undefined;
        }
        if (!profilePictureUrl && (contactObj.profilePictureThumb || contactObj.profilePicThumbObj)) {
          profilePictureUrl = contactObj.profilePictureThumb || contactObj.profilePicThumbObj?.eurl || undefined;
        }

        // FIX: usar getProfilePictureUrl (método correcto en versiones actuales de WPP)
        if (!profilePictureUrl && typeof WPP.contact.getProfilePictureUrl === 'function') {
          try {
            const picUrl = await WPP.contact.getProfilePictureUrl(realFrom);
            if (typeof picUrl === 'string' && picUrl.startsWith('http')) {
              profilePictureUrl = picUrl;
            }
          } catch (picErr) {
            console.warn("[EventEngine] Error obteniendo foto de perfil:", picErr);
          }
        }
      }
    } catch (err) {}
  }

  return {
    messageId: msg.id?._serialized,
    chatId: realChatId,
    from: realFrom,
    to: realTo,
    body: cleanBody,
    text: cleanBody,
    type: msg.type,
    timestamp: msg.t,
    fromMe: msg.id?.fromMe || false,
    author,
    media,
    ack: msg.ack,
    phoneNumber,
    pushname,
    notifyName,
    displayName,
    profilePictureUrl,
  };
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
  if ((window as any).__MAPLE_CONTACT_ENRICHER_LOADED) return;
  (window as any).__MAPLE_CONTACT_ENRICHER_LOADED = true;

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

    // Enriquecer cada vez que llega un mensaje nuevo
    try {
      (window as any).WPP.on?.('chat.new_message', async (msg: any) => {
        try {
          const cid = msg?.id?.remote?._serialized
            || msg?.from?._serialized
            || msg?.chatId;
          if (!cid || cid.endsWith('@g.us')) return;
          // Invalidar throttling para este chat
          SENT_CACHE.delete(cid);
          const chat = await (window as any).WPP.chat.find(cid).catch(()=>null);
          await enrichChat(chat || { id: { _serialized: cid } });
        } catch(e){}
      });
    } catch(e){}

    console.log('[MAPLE ENRICHER] Contact enricher activo');
  })();

  // Expose for debugging
  (window as any).__MAPLE_RESOLVE_LID = resolveLidToPhone;
  (window as any).__MAPLE_ENRICH_ALL = enrichAll;
})();
