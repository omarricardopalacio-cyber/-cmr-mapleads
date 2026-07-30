import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { triggerFlows } from "@/lib/flow-trigger.server";

const COMPRO_TAG_NAME = "Compró";
const COMPRO_TAG_COLOR = "#16a34a";

/**
 * Al confirmar compra: asegura la etiqueta "Compró" en el contacto y dispara flujos tag_added.
 */
export async function assignComproTag(params: {
  orgId: string;
  contactId?: string | null;
  /** Evita reentrada cuando el vigilante ya marcó compro */
  skipWatcher?: boolean;
}): Promise<{ assigned: boolean; tagId?: string }> {
  const contactId = params.contactId ? String(params.contactId) : "";
  if (!contactId) return { assigned: false };

  try {
    let tagId: string | null = null;
    const { data: existing } = await (supabaseAdmin as any)
      .from("tags")
      .select("id")
      .eq("org_id", params.orgId)
      .ilike("name", COMPRO_TAG_NAME)
      .maybeSingle();

    if (existing?.id) {
      tagId = String(existing.id);
    } else {
      const { data: created, error } = await (supabaseAdmin as any)
        .from("tags")
        .insert({
          org_id: params.orgId,
          name: COMPRO_TAG_NAME,
          color: COMPRO_TAG_COLOR,
        })
        .select("id")
        .single();
      if (error || !created?.id) {
        console.warn("[assignComproTag] create tag", error?.message || error);
        return { assigned: false };
      }
      tagId = String(created.id);
    }

    const { error: linkErr } = await (supabaseAdmin as any)
      .from("contact_tags")
      .insert({ contact_id: contactId, tag_id: tagId });

    if (linkErr && linkErr.code !== "23505") {
      console.warn("[assignComproTag] link", linkErr.message);
      return { assigned: false, tagId };
    }

    triggerFlows({
      orgId: params.orgId,
      contactId,
      triggerType: "tag_added",
      triggerValue: tagId!,
    }).catch((err) => console.warn("[assignComproTag] triggerFlows", err));

    // Vigilante: intención "compro" → solo el último flujo asignado
    if (!params.skipWatcher) {
      import("@/lib/intent-watcher.server")
        .then(({ runIntentWatcher }) =>
          runIntentWatcher({
            orgId: params.orgId,
            contactId,
            trigger: "purchase",
            forcedIntentKey: "compro",
          }),
        )
        .catch((err) => console.warn("[assignComproTag] watcher", err));
    }

    return { assigned: true, tagId: tagId! };
  } catch (err) {
    console.warn(
      "[assignComproTag]",
      err instanceof Error ? err.message : String(err),
    );
    return { assigned: false };
  }
}
