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
  // Si display_name es nulo, vacío, 'unknown' o igual al wa_id, usar teléfono formateado
  if (!contact?.display_name || contact.display_name === "unknown" || contact.display_name.trim() === "" || contact.display_name === contact.wa_id) {
    const formattedPhone = formatPhoneOrWaId(contact);
    if (formattedPhone !== 'Sin Número') {
      const cleanPhone = formattedPhone.replace(/\D/g, ''); // Solo dígitos
      const last4 = cleanPhone.slice(-4);
      return `Cliente ${last4}`;
    }
  }
  // Si tiene un display_name válido, usarlo
  if (contact?.display_name && contact.display_name !== "unknown" && contact.display_name.trim() !== "") {
    let name = contact.display_name.trim();
    if (name.startsWith('~')) {
      name = name.substring(1).trim();
    }
    return name;
  }
  // Fallback final
  return `Cliente ${indexFallback ?? "Nuevo"}`;
}

export function formatPhoneOrWaId(contact: ContactLike | null | undefined): string {
  if (!contact) return 'Sin Número';
  // 1. Prioridad: Si tiene teléfono real, muéstralo con un '+' elegante
  if (contact.phone && contact.phone.trim() !== '') {
    const cleanPhone = contact.phone.replace(/\D/g, ''); // Solo dígitos
    return `+${cleanPhone}`;
  }
  // 2. Si es un JID (@lid o @c.us), límpialo de raíz
  if (contact.wa_id) {
    const cleanId = contact.wa_id.split('@')[0]; // Toma solo los números antes del arroba
    return `+${cleanId}`;
  }
  return 'Sin Número';
}
