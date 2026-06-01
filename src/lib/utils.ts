import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ContactLike {
  display_name?: string | null;
  phone?: string | null;
  wa_id?: string | null;
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
  if (isAnonymousName(contact?.display_name, contact?.wa_id)) {
    const formattedPhone = formatPhoneOrWaId(contact);
    if (formattedPhone !== "Sin Número") {
      const cleanPhone = formattedPhone.replace(/\D/g, "");
      const last4 = cleanPhone.slice(-4);
      return `Cliente ${last4}`;
    }
    return `Cliente ${indexFallback ?? "Nuevo"}`;
  }
  let name = (contact!.display_name as string).trim();
  if (name.startsWith("~")) name = name.substring(1).trim();
  return name;
}

export function formatPhoneOrWaId(contact: ContactLike | null | undefined): string {
  if (!contact) return "Sin Número";
  if (contact.phone && contact.phone.trim() !== "") {
    const cleanPhone = contact.phone.replace(/\D/g, "");
    return `+${cleanPhone}`;
  }
  // Los @lid no son números de teléfono reales; no los mostramos como tales
  if (contact.wa_id && !isLidWaId(contact.wa_id)) {
    const cleanId = contact.wa_id.split("@")[0];
    if (/^\d{6,}$/.test(cleanId)) return `+${cleanId}`;
  }
  return "Sin Número";
}
