// ============================================================
// MAPLE WA ENGINE — Resolver LID → teléfono + foto de perfil
// Corre en la página de WhatsApp Web (WPP / WA-JS) ANTES del ingest.
// ============================================================

import { getWPP } from "./wpp-bootstrap";
import {
  canonicalWaId,
  digitsOnly,
  httpProfileUrl,
  isGroupJid,
  isLidJid,
  isRealPhoneDigits,
  sanitizePhoneForIngest,
} from "../shared/wa-identity";

const PHONE_CACHE = new Map<string, string>();

export type ContactCard = {
  waId: string;
  chatId: string;
  phone?: string;
  displayName?: string;
  pushname?: string;
  profilePictureUrl?: string;
  isGroup: false;
};

function createWid(WPP: any, jid: string): any {
  try {
    if (WPP?.whatsapp?.createWid) return WPP.whatsapp.createWid(jid);
    if (WPP?.whatsapp?.WidFactory?.createWid) return WPP.whatsapp.WidFactory.createWid(jid);
    if (WPP?.whatsapp?.Wid?.create) return WPP.whatsapp.Wid.create(jid);
  } catch {
    /* ignore */
  }
  const [user, server] = jid.split("@");
  return { user, server, _serialized: jid, isLid: () => server === "lid" };
}

/**
 * Extrae un celular de un Wid / string.
 * Rechaza el propio LID y los ids que el CRM mostraría como +1….
 */
export function pickPhoneCandidate(value: unknown, lidJid?: string): string | null {
  if (value == null) return null;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.phoneNumber) {
      const nested = pickPhoneCandidate(record.phoneNumber, lidJid);
      if (nested) return nested;
    }
    const serialized = String(record._serialized || "");
    const server = String(record.server || "");
    if (serialized.endsWith("@lid") || serialized.endsWith("@g.us") || server === "lid") {
      return null;
    }
    if (
      serialized.endsWith("@c.us") ||
      serialized.endsWith("@s.whatsapp.net") ||
      server === "c.us" ||
      server === "s.whatsapp.net"
    ) {
      const d = digitsOnly(serialized || record.user || record.id);
      return isRealPhoneDigits(d, lidJid) ? d : null;
    }
    return null;
  }

  const text = String(value).trim();
  if (!text || text.includes("@lid") || text.includes("@g.us")) return null;
  const d = digitsOnly(text);
  if (!isRealPhoneDigits(d, lidJid)) return null;
  if (!text.includes("@") && d.length > 13) return null;
  return d;
}

function pushKnownFields(target: unknown[], source: any): void {
  if (!source || typeof source !== "object") return;
  const keys = [
    "phoneNumber",
    "pnJid",
    "pnUser",
    "peerPhoneNumber",
    "userid",
    "phone",
    "wid",
    "id",
  ];
  for (const key of keys) {
    if (source[key] != null) target.push(source[key]);
  }
}

async function firstPhone(candidates: unknown[], lidJid: string): Promise<string | null> {
  for (const candidate of candidates) {
    const phone = pickPhoneCandidate(candidate, lidJid);
    if (phone) return phone;
  }
  return null;
}

/**
 * Resuelve `…@lid` al celular real usando la caché LID↔PN de WhatsApp Web
 * (getPnLidEntry / lidPnCache) y, si hace falta, el contacto ya cargado.
 * No llama a requestPhoneNumber: eso envía un mensaje al chat.
 */
export async function resolveLidToPhoneDigits(
  lid: string,
  hints?: { msg?: any; contact?: any; chat?: any },
): Promise<string | null> {
  if (!lid || typeof lid !== "string") return null;
  const jid = lid.includes("@") ? lid : `${digitsOnly(lid)}@lid`;
  if (!isLidJid(jid)) {
    const d = digitsOnly(jid);
    return isRealPhoneDigits(d) && d.length <= 13 ? d : null;
  }
  const cached = PHONE_CACHE.get(jid);
  if (cached) return cached;

  const WPP = getWPP();
  const candidates: unknown[] = [];
  pushKnownFields(candidates, hints?.contact);
  pushKnownFields(candidates, hints?.chat?.contact);
  pushKnownFields(candidates, hints?.chat);
  pushKnownFields(candidates, hints?.msg?.sender);
  pushKnownFields(candidates, hints?.msg?.senderObj);
  pushKnownFields(candidates, hints?.msg);

  let phone = await firstPhone(candidates, jid);
  if (!WPP && !phone) return null;

  if (!phone && WPP) {
    try {
      const entry = await WPP.contact?.getPnLidEntry?.(jid);
      phone = pickPhoneCandidate(entry?.phoneNumber || entry?.pn, jid);
    } catch {
      /* ignore */
    }
  }

  if (!phone && WPP) {
    try {
      const wid = createWid(WPP, jid);
      const cache = WPP.whatsapp?.lidPnCache;
      const pn = cache?.getPhoneNumber?.(wid);
      const entry = cache?.getLidEntry?.(wid);
      phone =
        pickPhoneCandidate(pn, jid) ||
        pickPhoneCandidate(entry?.phoneNumber, jid) ||
        pickPhoneCandidate(entry, jid);
    } catch {
      /* ignore */
    }
  }

  if (!phone && WPP) {
    try {
      const contact = hints?.contact || (await WPP.contact?.get?.(jid));
      const more: unknown[] = [];
      pushKnownFields(more, contact);
      phone = await firstPhone(more, jid);
    } catch {
      /* ignore */
    }
  }

  if (!phone && WPP) {
    try {
      const chat =
        hints?.chat ||
        (typeof WPP.chat?.get === "function" ? await WPP.chat.get(jid) : null) ||
        (await WPP.chat?.find?.(jid));
      const more: unknown[] = [];
      pushKnownFields(more, chat?.contact);
      pushKnownFields(more, chat);
      phone = await firstPhone(more, jid);
    } catch {
      /* ignore */
    }
  }

  if (!phone && WPP) {
    try {
      const wid = createWid(WPP, jid);
      const pn = await WPP.whatsapp?.ApiContact?.getPhoneNumber?.(wid);
      phone = pickPhoneCandidate(pn, jid);
    } catch {
      /* ignore */
    }
  }

  if (!phone) {
    try {
      const req = (window as any).require;
      if (typeof req === "function" && WPP) {
        const api = req("WAWebApiContact");
        const wid = createWid(WPP, jid);
        const pn =
          (typeof api?.getPhoneNumber === "function" ? await api.getPhoneNumber(wid) : null) ||
          (typeof api?.getExistingPhoneNumber === "function" ? api.getExistingPhoneNumber(wid) : null);
        phone = pickPhoneCandidate(pn, jid);
      }
    } catch {
      /* módulo ausente en esta build de WA */
    }
  }

  if (!phone && WPP) {
    try {
      const maps = [
        WPP.whatsapp?.LidToPnMap,
        WPP.whatsapp?.LidUtils,
        WPP.whatsapp?.LidPnMap,
        WPP.whatsapp?.SignalDeviceLidPnMap,
        WPP.whatsapp?.Lid1X1MigrationUtils,
      ].filter(Boolean);
      const fnNames = [
        "findPnForLid",
        "getPnForLid",
        "getPhoneNumber",
        "getPn",
        "getPhoneForLid",
        "lidToPn",
        "getDisplayNameOrPnForLid",
      ];
      for (const map of maps) {
        for (const name of fnNames) {
          if (typeof map[name] !== "function") continue;
          try {
            const pn = await map[name](jid);
            phone = pickPhoneCandidate(pn, jid);
            if (phone) break;
          } catch {
            /* siguiente */
          }
        }
        if (phone) break;
      }
    } catch {
      /* ignore */
    }
  }

  if (!phone && WPP) {
    try {
      const result = await WPP.contact?.queryExists?.(jid);
      phone = pickPhoneCandidate(result?.wid || result?.phoneNumber || result, jid);
    } catch {
      /* ignore */
    }
  }

  if (phone) PHONE_CACHE.set(jid, phone);
  return phone;
}

function thumbUrl(source: any): string | undefined {
  if (!source) return undefined;
  return (
    httpProfileUrl(source?.eurl) ||
    httpProfileUrl(source?.imgFull) ||
    httpProfileUrl(source?.img) ||
    httpProfileUrl(source?.previewEurl)
  );
}

/** Foto de perfil. Prueba el `@c.us` resuelto y el `@lid`: el thumb a veces vive en uno solo. */
export async function fetchProfilePictureUrl(
  jids: Array<string | undefined | null>,
  contact?: any,
): Promise<string | undefined> {
  const fromContact =
    thumbUrl(contact?.profilePicThumb) ||
    thumbUrl(contact?.profilePicThumbObj) ||
    httpProfileUrl(contact?.profilePictureThumb);
  if (fromContact) return fromContact;

  const WPP = getWPP();
  const unique = [...new Set(jids.filter((j): j is string => typeof j === "string" && j.includes("@")))];
  for (const jid of unique) {
    if (!WPP) break;
    try {
      if (typeof WPP.contact?.getProfilePictureUrl === "function") {
        const full = await WPP.contact.getProfilePictureUrl(jid, true);
        const fullUrl = httpProfileUrl(full);
        if (fullUrl) return fullUrl;
        const small = await WPP.contact.getProfilePictureUrl(jid, false);
        const smallUrl = httpProfileUrl(small);
        if (smallUrl) return smallUrl;
      }
    } catch {
      /* ignore */
    }
    try {
      const store = WPP.whatsapp?.ProfilePicThumbStore;
      const thumb =
        (typeof store?.get === "function" ? store.get(jid) : null) ||
        (typeof store?.find === "function" ? await store.find(jid) : null);
      const url = thumbUrl(thumb);
      if (url) return url;
    } catch {
      /* ignore */
    }
    try {
      const loaded = await WPP.contact?.get?.(jid);
      const url = thumbUrl(loaded?.profilePicThumb) || thumbUrl(loaded?.profilePicThumbObj);
      if (url) return url;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function pickDisplayName(contact: any, chat: any, phone: string | null, cid: string): string | undefined {
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
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name || /^cliente\s*\d+/i.test(name) || name.toLowerCase() === "unknown") continue;
    const digits = name.replace(/\D/g, "");
    if (isLidJid(cid) && digits && digits === digitsOnly(cid)) continue;
    if (phone && digits === phone && !/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(name)) continue;
    return name;
  }
  return phone ? `+${phone}` : undefined;
}

/** Ficha lista para ingest: teléfono real o `@lid` con phone vacío, más foto si WA la tiene. */
export async function resolveContactCard(
  chatId: string,
  hints?: { chat?: any; contact?: any; msg?: any },
): Promise<ContactCard | null> {
  if (!chatId || isGroupJid(chatId)) return null;
  const WPP = getWPP();

  let contact = hints?.contact;
  let chat = hints?.chat;
  if (WPP && !contact) {
    try {
      contact = await WPP.contact.get(chatId);
    } catch {
      contact = null;
    }
  }
  if (WPP && !chat) {
    try {
      chat =
        typeof WPP.chat?.get === "function" ? await WPP.chat.get(chatId) : await WPP.chat?.find?.(chatId);
    } catch {
      chat = null;
    }
  }

  let phone: string | null = null;
  if (isLidJid(chatId)) {
    phone = await resolveLidToPhoneDigits(chatId, { msg: hints?.msg, contact, chat });
  } else {
    phone = sanitizePhoneForIngest(chatId, chatId, { verifiedCus: chatId.endsWith("@c.us") }) || null;
  }

  const waId = phone ? `${phone}@c.us` : canonicalWaId(chatId);
  if (!waId) return null;

  const displayName = pickDisplayName(contact, chat, phone, chatId);
  const profilePictureUrl = await fetchProfilePictureUrl(
    [waId, phone ? `${phone}@s.whatsapp.net` : undefined, chatId],
    contact || chat?.contact,
  );

  return {
    waId,
    chatId: waId,
    phone: phone || undefined,
    displayName,
    pushname: contact?.pushname || contact?.notifyName || chat?.contact?.pushname || undefined,
    profilePictureUrl,
    isGroup: false,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

/**
 * Resuelve LID y adjunta contact + foto ANTES de emitir el mensaje al ingest.
 * Si WhatsApp no responde a tiempo, el JID queda en `@lid` y phone vacío.
 */
export async function applyIdentityToMessage(msg: any, base: any, budgetMs = 2500): Promise<any> {
  const started = Date.now();
  let chatId = typeof base?.chatId === "string" ? base.chatId : "";
  let from = typeof base?.from === "string" ? base.from : undefined;
  let to = typeof base?.to === "string" ? base.to : undefined;

  const resolveOne = async (jid?: string): Promise<string | undefined> => {
    if (!jid) return jid;
    if (!isLidJid(jid)) return canonicalWaId(jid) || jid;
    const phone = await resolveLidToPhoneDigits(jid, { msg });
    return phone ? `${phone}@c.us` : jid;
  };

  const left = () => Math.max(0, budgetMs - (Date.now() - started));
  const resolved = await withTimeout(
    (async () => {
      const nextChat = await resolveOne(chatId);
      const nextFrom = from ? await resolveOne(from) : from;
      const nextTo = to ? await resolveOne(to) : to;
      return { chatId: nextChat || chatId, from: nextFrom, to: nextTo };
    })(),
    left(),
  );
  if (resolved) {
    chatId = resolved.chatId;
    from = resolved.from;
    to = resolved.to;
  } else {
    chatId = canonicalWaId(chatId) || chatId;
    if (from) from = canonicalWaId(from) || from;
    if (to) to = canonicalWaId(to) || to;
  }

  const fromMe = !!base?.fromMe;
  const counterpart = (fromMe ? to || chatId : from || chatId) || chatId;
  const phone = sanitizePhoneForIngest(
    isLidJid(counterpart) ? undefined : counterpart,
    counterpart,
    { verifiedCus: String(counterpart).endsWith("@c.us") },
  );
  const waId = phone ? `${phone}@c.us` : canonicalWaId(counterpart) || canonicalWaId(chatId) || chatId;

  let profilePictureUrl = httpProfileUrl(base?.profilePictureUrl);
  if (!profilePictureUrl && left() > 200) {
    profilePictureUrl = await withTimeout(
      fetchProfilePictureUrl([waId, counterpart, base?.chatId, from, to], msg?.sender),
      left(),
    );
  }

  const displayName = base?.displayName || base?.pushname || base?.notifyName;
  return {
    ...base,
    chatId: phone ? `${phone}@c.us` : waId,
    from,
    to,
    profilePictureUrl,
    contact: {
      waId,
      phone: phone || undefined,
      displayName: displayName || undefined,
      profilePictureUrl,
    },
  };
}
