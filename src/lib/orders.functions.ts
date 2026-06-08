import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type MessageRow = {
  id: string;
  thread_id: string;
  direction: string;
  text: string | null;
  sent_at: string | null;
};

function claimsOrderRegistered(text: string | null | undefined) {
  const value = String(text ?? "").toLowerCase();
  const patterns: RegExp[] = [
    /pedido[\s\S]{0,60}(registrad[oa]|guardad[oa]|confirmad[oa]|en proceso|procesad[oa])/i,
    /(registrad[oa]|guardad[oa]|confirmad[oa])[\s\S]{0,40}(su |tu |el )?pedido/i,
    /gracias por su compra/i,
    /muchas gracias por su compra/i,
    /pedido ha sido (registrad|guardad|confirmad)/i,
  ];
  return patterns.some((pattern) => pattern.test(value));
}

function minutesBetween(a?: string | null, b?: string | null) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;
}

export const repairMissingConfirmedOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: role, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("org_id")
      .eq("user_id", context.userId)
      .limit(1)
      .maybeSingle();

    if (roleErr) {
      throw new Error(roleErr.message);
    }

    const orgId = role?.org_id;
    if (!orgId) {
      throw new Error("No organization found for user");
    }

    const { data: outgoing, error: outgoingError } = await supabaseAdmin
      .from("messages")
      .select("id, thread_id, direction, text, sent_at")
      .eq("org_id", orgId)
      .eq("direction", "out")
      .not("text", "is", null)
      .order("sent_at", { ascending: false })
      .limit(300);

    if (outgoingError) {
      throw new Error(outgoingError.message);
    }

    const candidates = ((outgoing ?? []) as MessageRow[]).filter((m) =>
      claimsOrderRegistered(m.text)
    );

    let repaired = 0;

    for (const candidate of candidates) {
      const { data: existingOrders, error: existingError } = await supabaseAdmin
        .from("orders")
        .select("id, created_at, form_data")
        .eq("org_id", orgId)
        .eq("thread_id", candidate.thread_id);

      if (existingError) {
        continue;
      }

      const alreadyTracked = (existingOrders ?? []).some((order: any) => {
        let fd: Record<string, unknown> = {};
        try {
          fd = typeof order.form_data === "string"
            ? JSON.parse(order.form_data || "{}")
            : order.form_data ?? {};
        } catch {
          fd = {};
        }
        return (
          fd._source_message_id === candidate.id ||
          minutesBetween(order.created_at, candidate.sent_at) <= 5
        );
      });

      if (alreadyTracked) continue;

      const { data: thread } = await supabaseAdmin
        .from("threads")
        .select("contact_id")
        .eq("id", candidate.thread_id)
        .eq("org_id", orgId)
        .maybeSingle();

      if (!thread) continue;

      const { data: history } = await supabaseAdmin
        .from("messages")
        .select("direction, text, sent_at")
        .eq("org_id", orgId)
        .eq("thread_id", candidate.thread_id)
        .not("text", "is", null)
        .lte("sent_at", candidate.sent_at ?? new Date().toISOString())
        .order("sent_at", { ascending: false })
        .limit(16);

      const chronological = [...(history ?? [])]
        .reverse()
        .filter((m) => m.text?.trim());

      const lastIncoming = [...chronological].reverse().find((m) => m.direction === "in")?.text?.trim() ?? "";

      const formData = {
        Origen: "Reparación automática desde mensaje confirmado en chat",
        "Confirmación cliente": lastIncoming,
        "Respuesta de confirmación enviada": candidate.text,
        "Historial reciente": chronological
          .map((m) => `${m.direction === "out" ? "Asistente" : "Cliente"}: ${m.text?.trim()}`)
          .join("\n"),
        _source_message_id: candidate.id,
        "Registrado en": new Date().toISOString(),
      } as Record<string, unknown>;

      const { error: insertError } = await supabaseAdmin.from("orders").insert({
        org_id: orgId,
        contact_id: thread.contact_id ?? null,
        thread_id: candidate.thread_id,
        status: "confirmed",
        form_data: formData,
      });

      if (insertError) continue;

      await supabaseAdmin
        .from("threads")
        .update({ purchase_intent: "compro" })
        .eq("id", candidate.thread_id)
        .eq("org_id", orgId);

      repaired += 1;
    }

    return { repaired };
  });
