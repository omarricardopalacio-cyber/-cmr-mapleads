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
  if (contact?.display_name && contact.display_name !== "unknown" && contact.display_name.trim() !== "") {
    return contact.display_name;
  }
  if (contact?.phone && contact.phone.trim() !== "") {
    return `Cliente ${contact.phone.slice(-4)}`;
  }
  if (contact?.wa_id) {
    const clean = contact.wa_id.replace(/@lid$/, "").replace(/@c\.us$/, "").replace(/@s\.whatsapp\.net$/, "");
    if (clean && clean.length > 3) return `Cliente ${clean}`;
  }
  return `Cliente ${indexFallback ?? "Nuevo"}`;
}

export function formatPhoneOrWaId(contact: ContactLike | null | undefined): string {
  if (contact?.phone && contact.phone.trim() !== "") {
    return `+${contact.phone.replace(/\D/g, "")}`;
  }
  if (contact?.wa_id) {
    return contact.wa_id.replace(/@lid$/, "").replace(/@c\.us$/, "").replace(/@s\.whatsapp\.net$/, "");
  }
  return "—";
}
