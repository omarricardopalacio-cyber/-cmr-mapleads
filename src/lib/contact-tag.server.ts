/**
 * Asigna etiqueta a un contacto sin disparar flujos (seguro para import histórico).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function ensureContactTag(params: {
  orgId: string;
  contactId: string;
  tagName: string;
  color?: string;
}): Promise<{ assigned: boolean; tagId?: string }> {
  const name = String(params.tagName || "").trim().slice(0, 80);
  if (!name || !params.contactId) return { assigned: false };

  try {
    let tagId: string | null = null;
    const { data: existing } = await (supabaseAdmin as any)
      .from("tags")
      .select("id")
      .eq("org_id", params.orgId)
      .ilike("name", name)
      .maybeSingle();

    if (existing?.id) {
      tagId = String(existing.id);
    } else {
      const { data: created, error } = await (supabaseAdmin as any)
        .from("tags")
        .insert({
          org_id: params.orgId,
          name,
          color: params.color || "#3b82f6",
        })
        .select("id")
        .single();
      if (error || !created?.id) {
        console.warn("[ensureContactTag] create", error?.message || error);
        return { assigned: false };
      }
      tagId = String(created.id);
    }

    const { error: linkErr } = await (supabaseAdmin as any)
      .from("contact_tags")
      .insert({ contact_id: params.contactId, tag_id: tagId });

    if (linkErr && linkErr.code !== "23505") {
      console.warn("[ensureContactTag] link", linkErr.message);
      return { assigned: false, tagId };
    }
    return { assigned: true, tagId: tagId! };
  } catch (err) {
    console.warn("[ensureContactTag]", (err as Error)?.message);
    return { assigned: false };
  }
}
