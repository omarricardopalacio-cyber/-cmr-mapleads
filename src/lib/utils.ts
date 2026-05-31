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

export function getContactDisplayName(contact: ContactLike | null | undefined, indexFallback?: number): string {
  const display = contact?.display_name?.trim() ?? "";
  const looksNumeric = /^\+?\d{6,}$/.test(display);
  if (display && display.toLowerCase() !== "unknown" && !looksNumeric) {
    return display;
  }
  return indexFallback ? `Cliente ${indexFallback}` : "Cliente";
}

export function formatPhoneOrWaId(contact: ContactLike | null | undefined): string {
  if (contact?.phone && contact.phone.trim() !== "") {
    return `+${contact.phone.replace(/\D/g, "")}`;
  }
  if (contact?.wa_id) {
    if (/@lid$/i.test(contact.wa_id)) return "Sin número";
    return contact.wa_id.replace(/@lid$/, "").replace(/@c\.us$/, "").replace(/@s\.whatsapp\.net$/, "");
  }
  return "—";
}
