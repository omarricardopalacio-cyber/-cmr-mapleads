import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MAX_PRODUCTS = 40;
const MAX_QUESTIONS = 80;
const MAX_QUESTION_CHARS = 500;

function splitLines(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinLines(lines: string[]): string | null {
  const out = lines.join("\n").trim();
  return out || null;
}

function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mensajes del cliente que parecen preguntas / consultas (no acuse simples). */
export function looksLikeCustomerQuestion(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 3) return false;
  if (
    /^(si|sí|ok|okay|dale|listo|hola|buenas|buen\s*d[ií]a|buenas\s*tardes|buenas\s*noches|gracias|no|ya|claro|perfecto|vale|de\s*acuerdo|jajaja+|jeje+|👍|🙏|✅)\.?$/i.test(
      t,
    )
  ) {
    return false;
  }
  if (/\?/.test(t)) return true;
  if (
    /\b(qu[eé]|cu[aá]l(es)?|cu[aá]nto|cu[aá]nta|c[oó]mo|d[oó]nde|por\s+qu[eé]|vale|cuesta|precio|env[ií]o|tienen|tiene|hay|disponible|stock|info|informaci[oó]n|quiero|busco|me\s+interesa|sirve|incluye|garant[ií]a|pago|contraentrega|cod)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // Frases con algo de contenido (evita solo "Medellín" / un nombre)
  if (t.length >= 14 && /\s/.test(t)) return true;
  return false;
}

async function readInquiryFields(orgId: string, contactId: string) {
  const { data } = await (supabaseAdmin as any)
    .from("contacts")
    .select("asked_products, asked_questions")
    .eq("id", contactId)
    .eq("org_id", orgId)
    .maybeSingle();
  return {
    products: splitLines(data?.asked_products),
    questions: splitLines(data?.asked_questions),
  };
}

/**
 * Acumula un producto consultado en el contacto (único por nombre).
 */
export async function appendContactAskedProduct(opts: {
  orgId: string;
  contactId: string | null | undefined;
  productName: string | null | undefined;
  productId?: string | null;
}): Promise<void> {
  const contactId = opts.contactId ? String(opts.contactId) : "";
  const name = String(opts.productName || "").trim();
  if (!contactId || !name) return;

  const line = opts.productId ? `${name}` : name;
  try {
    const { products, questions } = await readInquiryFields(opts.orgId, contactId);
    const key = normKey(name);
    if (products.some((p) => normKey(p) === key)) return;
    const next = [...products, line].slice(-MAX_PRODUCTS);
    const { error } = await (supabaseAdmin as any)
      .from("contacts")
      .update({
        asked_products: joinLines(next),
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId)
      .eq("org_id", opts.orgId);
    if (error) {
      // Columna puede no existir aún en prod
      if (String(error.message || "").includes("asked_products") || error.code === "42703") {
        console.warn(
          "[contact-inquiry] Falta migración asked_products. Ejecuta 20260728120000_contacts_asked_products_questions.sql",
        );
        return;
      }
      console.warn("[contact-inquiry] append product failed", error.message);
    }
    void questions;
  } catch (err) {
    console.warn(
      "[contact-inquiry] append product error",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Acumula una pregunta del cliente (solo inbound tipo consulta).
 */
export async function appendContactAskedQuestion(opts: {
  orgId: string;
  contactId: string | null | undefined;
  text: string | null | undefined;
}): Promise<void> {
  const contactId = opts.contactId ? String(opts.contactId) : "";
  const raw = String(opts.text || "").trim().slice(0, MAX_QUESTION_CHARS);
  if (!contactId || !raw) return;
  if (!looksLikeCustomerQuestion(raw)) return;

  try {
    const { products, questions } = await readInquiryFields(opts.orgId, contactId);
    const key = normKey(raw);
    // Evitar duplicado consecutivo o ya listado
    if (questions.some((q) => normKey(q) === key)) return;
    const next = [...questions, raw].slice(-MAX_QUESTIONS);
    const { error } = await (supabaseAdmin as any)
      .from("contacts")
      .update({
        asked_questions: joinLines(next),
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId)
      .eq("org_id", opts.orgId);
    if (error) {
      if (String(error.message || "").includes("asked_questions") || error.code === "42703") {
        console.warn(
          "[contact-inquiry] Falta migración asked_questions. Ejecuta 20260728120000_contacts_asked_products_questions.sql",
        );
        return;
      }
      console.warn("[contact-inquiry] append question failed", error.message);
    }
    void products;
  } catch (err) {
    console.warn(
      "[contact-inquiry] append question error",
      err instanceof Error ? err.message : String(err),
    );
  }
}
