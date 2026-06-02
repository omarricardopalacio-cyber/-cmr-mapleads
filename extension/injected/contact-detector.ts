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
