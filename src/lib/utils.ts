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
  // Placeholder de WA / CRM: "...", "…", ".", "-", "n/a"
  if (/^[.\-…·_*]+$/.test(trimmed)) return true;
  if (/^(n\/a|na|null|undefined|sin nombre)$/i.test(trimmed)) return true;
  // display_name puramente numérico = es el JID, no un nombre real
  if (/^\+?\d{6,}$/.test(trimmed)) return true;
  if (waId && trimmed === waId) return true;
  if (waId && trimmed === waId.split("@")[0]) return true;
  return false;
}

function isLidWaId(waId?: string | null): boolean {
  return !!waId && waId.endsWith("@lid");
}

/**
 * Contacto LID sin celular real → registro vacío (Cliente XXXX + "LID: …").
 * No debe mostrarse en Chats en Vivo hasta tener número (o fusionarse).
 */
export function isBlankLidContact(contact: ContactLike | null | undefined): boolean {
  if (!contact) return false;
  const waId = contact.wa_id || contact.waId;
  if (!isLidWaId(waId)) return false;
  const phoneDigits = contact.phone ? String(contact.phone).replace(/\D/g, "") : "";
  const lidDigits = String(waId).split("@")[0].replace(/\D/g, "");
  if (phoneDigits && phoneDigits !== lidDigits && phoneDigits.length >= 8) return false;
  return true;
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
  const waId = contact.wa_id || contact.waId;
  const phoneDigits = contact.phone ? contact.phone.replace(/\D/g, "") : "";
  const lidDigits = waId && isLidWaId(waId) ? waId.split("@")[0].replace(/\D/g, "") : "";

  // No mostrar el LID como si fuera un teléfono (+11875…)
  if (phoneDigits && !(lidDigits && phoneDigits === lidDigits)) {
    return `+${phoneDigits}`;
  }
  if (waId && isLidWaId(waId)) {
    return `LID: ${waId.split("@")[0]}`;
  }
  if (waId && !isLidWaId(waId)) {
    const cleanId = waId.split("@")[0];
    if (/^\d{6,}$/.test(cleanId)) return `+${cleanId}`;
  }
  return "Sin Número";
}
