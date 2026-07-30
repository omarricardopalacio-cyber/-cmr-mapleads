/**
 * Detección de segmentos de entrada (frase/emoticon de anuncios).
 * Solo actualiza ficha; no habla con el cliente.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AdSegmentRow = {
  id: string;
  name: string;
  match_phrase: string;
  match_mode: "contains" | "equals" | "starts";
  flow_id: string | null;
  priority: number;
};

function normalize(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchAdSegment(
  text: string,
  segments: AdSegmentRow[],
): AdSegmentRow | null {
  const hay = normalize(text);
  if (!hay) return null;
  const sorted = [...segments].sort((a, b) => b.priority - a.priority);
  for (const seg of sorted) {
    const needle = normalize(seg.match_phrase);
    if (!needle) continue;
    if (seg.match_mode === "equals" && hay === needle) return seg;
    if (seg.match_mode === "starts" && hay.startsWith(needle)) return seg;
    if ((seg.match_mode === "contains" || !seg.match_mode) && hay.includes(needle)) {
      return seg;
    }
  }
  return null;
}

export async function loadActiveAdSegments(orgId: string): Promise<AdSegmentRow[]> {
  const { data, error } = await (supabaseAdmin as any)
    .from("ad_segments")
    .select("id, name, match_phrase, match_mode, flow_id, priority")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("priority", { ascending: false });
  if (error) {
    console.warn("[ad-segments] load:", error.message);
    return [];
  }
  return (data ?? []) as AdSegmentRow[];
}

/**
 * Aplica segmento al contacto si aún no tiene uno (o force=true).
 * No inicia flujos.
 */
export async function applyEntrySegmentToContact(params: {
  orgId: string;
  contactId: string;
  text: string;
  force?: boolean;
}): Promise<{ applied: boolean; segment?: AdSegmentRow | null; skipped?: string }> {
  const { orgId, contactId, text, force } = params;
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, entry_segment_id")
    .eq("id", contactId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!contact) return { applied: false, skipped: "contacto_no_encontrado" };
  if ((contact as any).entry_segment_id && !force) {
    return { applied: false, skipped: "ya_tiene_segmento" };
  }

  const segments = await loadActiveAdSegments(orgId);
  if (!segments.length) return { applied: false, skipped: "sin_segmentos" };

  const matched = matchAdSegment(text, segments);
  if (!matched) return { applied: false, skipped: "sin_match", segment: null };

  const now = new Date().toISOString();
  const origin = `llegó por segmento "${matched.name}" porque llegó con la frase "${matched.match_phrase}"`;
  const { error } = await supabaseAdmin
    .from("contacts")
    .update({
      entry_segment: matched.name,
      entry_phrase: matched.match_phrase,
      entry_origin_summary: origin,
      entry_segment_at: now,
      entry_segment_id: matched.id,
      updated_at: now,
    } as any)
    .eq("id", contactId)
    .eq("org_id", orgId);

  if (error) {
    console.warn("[ad-segments] apply:", error.message);
    return { applied: false, skipped: error.message, segment: matched };
  }
  return { applied: true, segment: matched };
}
