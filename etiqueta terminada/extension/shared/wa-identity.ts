// ============================================================
// MAPLE WA ENGINE — Identidad WhatsApp (teléfono vs LID)
//
// Un LID (`123…@lid` o un id largo sin dominio) NO es un celular.
// Si se manda como `phone`, el CRM lo pinta como +1… / UID.
// ============================================================

export const MIN_PHONE_LEN = 8;
/** E.164 máximo. Por encima de esto no es un celular. */
export const MAX_PHONE_LEN = 15;
/**
 * Sin un `@c.us` verificado, 14–15 dígitos se tratan como LID.
 * Los móviles que usa el CRM (CO +57, etc.) caben en 8–13.
 */
export const MAX_UNVERIFIED_PHONE_LEN = 13;

export function digitsOnly(value: unknown): string {
  if (value == null) return "";
  return String(value).split("@")[0].replace(/\D/g, "");
}

export function isLidJid(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase().endsWith("@lid");
}

export function isGroupJid(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase().endsWith("@g.us");
}

export function isCusJid(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v.endsWith("@c.us") || v.endsWith("@s.whatsapp.net");
}

/**
 * Dígitos que no deben guardarse como teléfono.
 * Cubre el LID exacto, ids de más de 15 dígitos y los 14–15 que empiezan por 1
 * (el CRM los muestra como +1…).
 */
export function looksLikeLidDigits(digits: string | null | undefined, lidJid?: string | null): boolean {
  if (!digits) return false;
  if (lidJid) {
    const lidDigits = digitsOnly(lidJid);
    if (lidDigits && digits === lidDigits) return true;
  }
  if (digits.length > MAX_PHONE_LEN) return true;
  if (digits.length >= 14 && digits.startsWith("1")) return true;
  return false;
}

/** Teléfono real (E.164), nunca el user-part de un `@lid`. */
export function isRealPhoneDigits(digits: string | null | undefined, lidJid?: string | null): boolean {
  if (!digits) return false;
  if (digits.length < MIN_PHONE_LEN || digits.length > MAX_PHONE_LEN) return false;
  if (looksLikeLidDigits(digits, lidJid)) return false;
  return true;
}

/**
 * Acepta un teléfono para el backend.
 * `verifiedCus`: el valor salió de un JID `@c.us` / `@s.whatsapp.net` de WhatsApp,
 * no de un id crudo. Sin eso, 14+ dígitos se descartan (LID sin resolver).
 */
export function sanitizePhoneForIngest(
  phone: unknown,
  waId?: unknown,
  opts?: { verifiedCus?: boolean },
): string | undefined {
  if (phone == null || phone === "") return undefined;
  const raw = String(phone).trim();
  if (!raw || raw.toLowerCase().includes("@lid")) return undefined;
  const d = digitsOnly(raw);
  const lidHint = isLidJid(waId) ? String(waId) : undefined;
  if (!isRealPhoneDigits(d, lidHint)) return undefined;
  if (!opts?.verifiedCus && !isCusJid(raw) && d.length > MAX_UNVERIFIED_PHONE_LEN) return undefined;
  if (!opts?.verifiedCus && isCusJid(waId) && d.length > MAX_UNVERIFIED_PHONE_LEN && looksLikeLidDigits(d)) {
    return undefined;
  }
  return d;
}

/**
 * JID canónico para ingest.
 * - Teléfono real → `digits@c.us`
 * - LID o id largo sin resolver → `digits@lid`
 * - Grupo → se conserva `@g.us`
 */
export function canonicalWaId(raw: unknown, resolvedPhone?: string | null): string {
  const phone = resolvedPhone ? sanitizePhoneForIngest(resolvedPhone, raw, { verifiedCus: true }) : undefined;
  if (phone) return `${phone}@c.us`;

  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (isGroupJid(s)) return s;
  if (isLidJid(s)) {
    const user = s.split("@")[0];
    return user ? `${user}@lid` : "";
  }
  if (isCusJid(s)) {
    const d = digitsOnly(s);
    if (isRealPhoneDigits(d) && d.length <= MAX_UNVERIFIED_PHONE_LEN) return `${d}@c.us`;
    if (isRealPhoneDigits(d)) return `${d}@c.us`;
    return d ? `${d}@lid` : "";
  }

  const d = digitsOnly(s);
  if (!d) return "";
  if (looksLikeLidDigits(d) || d.length > MAX_UNVERIFIED_PHONE_LEN) return `${d}@lid`;
  if (isRealPhoneDigits(d)) return `${d}@c.us`;
  return "";
}

export function httpProfileUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  if (!/^https?:\/\//i.test(url) || url.length > 2000) return undefined;
  return url;
}

export type IngestContact = {
  waId: string;
  phone?: string;
  displayName?: string;
  profilePictureUrl?: string;
};

export type IngestIdentity = {
  contact?: IngestContact;
  chatId?: string;
  phone?: string;
};

/**
 * Última barrera antes de POST /ingest.
 * Nunca deja salir un LID en `phone`, ni un id crudo disfrazado de `@c.us`.
 */
export function buildIngestContact(opts: {
  counterpartJid?: unknown;
  contactWaId?: unknown;
  contactPhone?: unknown;
  displayName?: unknown;
  profilePictureUrl?: unknown;
  extraProfilePictureUrl?: unknown;
  /**
   * CONTACT_INFO: conservar el `@lid` como wa_id y mandar el celular en `phone`,
   * para que el CRM actualice la ficha LID en lugar de crear un +1….
   */
  keepLidKey?: boolean;
}): IngestIdentity {
  const rawCounterpart = typeof opts.counterpartJid === "string" ? opts.counterpartJid.trim() : "";
  const rawWa = typeof opts.contactWaId === "string" ? opts.contactWaId.trim() : "";
  const seed = rawWa || rawCounterpart;

  const verified =
    isCusJid(rawWa) || isCusJid(rawCounterpart) || isCusJid(opts.contactPhone);
  const phone =
    sanitizePhoneForIngest(opts.contactPhone, seed, { verifiedCus: verified && isCusJid(opts.contactPhone) }) ||
    sanitizePhoneForIngest(isCusJid(rawCounterpart) ? rawCounterpart : undefined, seed, { verifiedCus: true }) ||
    sanitizePhoneForIngest(isCusJid(rawWa) ? rawWa : undefined, seed, { verifiedCus: true }) ||
    sanitizePhoneForIngest(
      !isLidJid(rawCounterpart) && !isCusJid(rawCounterpart) ? rawCounterpart : undefined,
      seed,
    ) ||
    undefined;

  const lidKey = isLidJid(rawWa)
    ? canonicalWaId(rawWa)
    : isLidJid(rawCounterpart)
      ? canonicalWaId(rawCounterpart)
      : "";
  const waId =
    opts.keepLidKey && lidKey
      ? lidKey
      : phone
        ? `${phone}@c.us`
        : canonicalWaId(seed || rawCounterpart || rawWa);
  if (!waId) return {};

  const profilePictureUrl =
    httpProfileUrl(opts.profilePictureUrl) || httpProfileUrl(opts.extraProfilePictureUrl);
  const displayName =
    typeof opts.displayName === "string" && opts.displayName.trim() ? opts.displayName.trim() : undefined;

  return {
    phone,
    chatId: waId,
    contact: {
      waId,
      phone,
      displayName,
      profilePictureUrl,
    },
  };
}
