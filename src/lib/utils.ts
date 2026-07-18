import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ContactLike {
  display_name?: string | null;
  displayName?: string | null;
  phone?: string | null;
  wa_id?: string | null;
  waId?: string | null;
}

function isAnonymousName(name?: string | null, waId?: string | null): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return true;
  // display_name puramente numérico = es el JID, no un nombre real
  if (/^\+?\d{6,}$/.test(trimmed)) return true;
  if (waId && trimmed === waId) return true;
  if (waId && trimmed === waId.split("@")[0]) return true;
  return false;
}

function isLidWaId(waId?: string | null): boolean {
  return !!waId && waId.endsWith("@lid");
}

export function getContactDisplayName(contact: ContactLike | null | undefined, indexFallback?: number): string {
  const displayName = contact?.display_name || contact?.displayName;
  const waId = contact?.wa_id || contact?.waId;

  if (isAnonymousName(displayName, waId)) {
    const formattedPhone = formatPhoneOrWaId(contact);
    if (formattedPhone !== "Sin Número") {
      const cleanPhone = formattedPhone.replace(/\D/g, "");
      const last4 = cleanPhone.slice(-4);
      return `Cliente ${last4}`;
    }
    return `Cliente ${indexFallback ?? "Nuevo"}`;
  }
  let name = (displayName as string).trim();
  if (name.startsWith("~")) name = name.substring(1).trim();
  return name;
}

export function formatPhoneOrWaId(contact: ContactLike | null | undefined): string {
  if (!contact) return "Sin Número";
  if (contact.phone && contact.phone.trim() !== "") {
    const cleanPhone = contact.phone.replace(/\D/g, "");
    return `+${cleanPhone}`;
  }
  const waId = contact.wa_id || contact.waId;
  if (waId && isLidWaId(waId)) {
    return `LID: ${waId.split("@")[0]}`;
  }
  if (waId && !isLidWaId(waId)) {
    const cleanId = waId.split("@")[0];
    if (/^\d{6,}$/.test(cleanId)) return `+${cleanId}`;
  }
  return "Sin Número";
}
