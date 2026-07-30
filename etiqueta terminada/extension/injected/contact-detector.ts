// ============================================================
// MAPLE WA ENGINE — Contact Detector (Injected Script)
// Extracción de contactos, grupos y perfiles
// ============================================================

import { getWPP } from "./wpp-bootstrap";

export async function getContactList(): Promise<any[]> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");
  const contacts = await WPP.contact.list();
  return contacts.map(normalizeContact);
}

export async function getContact(contactId: string): Promise<any | null> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  try {
    const contact = await WPP.contact.get(contactId);
    return contact ? normalizeContact(contact) : null;
  } catch {
    return null;
  }
}

/** Nombre + teléfono + foto para import/historial (usa resolver LID del enricher). */
export async function resolveContactForImport(chatId: string): Promise<{
  waId: string;
  phone?: string;
  displayName?: string;
  profilePictureUrl?: string;
} | null> {
  const WPP = getWPP();
  if (!WPP || !chatId) return null;

  let phone: string | undefined;
  try {
    const resolveLid = (window as any).__MAPLE_RESOLVE_LID as
      | ((id: string) => Promise<string | null>)
      | undefined;
    if (chatId.endsWith("@lid") && typeof resolveLid === "function") {
      phone = (await resolveLid(chatId)) || undefined;
    } else if (chatId.endsWith("@c.us")) {
      const d = chatId.split("@")[0].replace(/\D/g, "");
      if (d.length >= 8 && d.length <= 15) phone = d;
    }
  } catch {
    /* ignore */
  }

  let contact: any = null;
  let chat: any = null;
  try {
    contact = await WPP.contact.get(chatId);
  } catch {
    /* ignore */
  }
  try {
    chat = typeof (WPP.chat as any).get === "function"
      ? await (WPP.chat as any).get(chatId)
      : await WPP.chat.find(chatId);
  } catch {
    /* ignore */
  }

  const nameCandidates = [
    contact?.name,
    contact?.verifiedName,
    contact?.displayName,
    contact?.pushname,
    contact?.formattedName,
    chat?.name,
    chat?.formattedTitle,
  ];
  let displayName: string | undefined;
  for (const raw of nameCandidates) {
    if (typeof raw !== "string") continue;
    const n = raw.trim();
    if (!n || /^cliente\s*\d+/i.test(n) || n.toLowerCase() === "unknown") continue;
    displayName = n;
    break;
  }

  let profilePictureUrl: string | undefined;
  try {
    const url = await WPP.contact.getProfilePictureUrl(chatId);
    if (typeof url === "string" && url.startsWith("http")) profilePictureUrl = url;
  } catch {
    /* ignore */
  }
  if (!profilePictureUrl) {
    const thumb =
      contact?.profilePicThumb?.eurl ||
      contact?.profilePicThumb?.imgFull ||
      contact?.profilePicThumb?.img;
    if (typeof thumb === "string" && thumb.startsWith("http")) profilePictureUrl = thumb;
  }

  return {
    waId: chatId,
    phone,
    displayName: displayName || (phone ? `+${phone}` : undefined),
    profilePictureUrl,
  };
}

export async function getProfilePictureUrl(contactId: string): Promise<string | null> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  try {
    return await WPP.contact.getProfilePictureUrl(contactId);
  } catch {
    return null;
  }
}

export async function getPhoneNumber(wid: any): Promise<string | null> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  try {
    const number = await WPP.whatsapp.ApiContact.getPhoneNumber(wid);
    return number?._serialized || number?.user || null;
  } catch {
    return null;
  }
}

export async function getLabels(): Promise<any[]> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");
  return WPP.labels.getAllLabels();
}

function normalizeContact(contact: any): any {
  return {
    contactId: contact.id?._serialized,
    user: contact.id?.user,
    server: contact.id?.server,
    name: contact.name || "",
    displayName: contact.displayName || "",
    pushname: contact.pushname || "",
    verifiedName: contact.verifiedName || "",
    shortName: contact.shortName || "",
    picture: contact.profilePicThumb?.img || null,
    labels: (contact.labels || []).map((l: any) => (typeof l === "string" ? l : l.id)),
    isBusiness: contact.isBusiness || false,
    isGroup: contact.id?.server === "g.us",
  };
}
