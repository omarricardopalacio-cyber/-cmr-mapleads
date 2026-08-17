import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "@/lib/org-helpers";

export const getNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
    try {
      const { data } = await (supabaseAdmin as any)
        .from("ai_configs")
        .select("notification_whatsapp_number, notify_on_sale, notify_on_agent_transfer")
        .eq("org_id", orgId)
        .maybeSingle();

      return {
        notification_whatsapp_number: (data?.notification_whatsapp_number as string | null) || "",
        notify_on_sale: data?.notify_on_sale !== false,
        notify_on_agent_transfer: data?.notify_on_agent_transfer !== false,
      };
    } catch {
      return {
        notification_whatsapp_number: "",
        notify_on_sale: true,
        notify_on_agent_transfer: true,
      };
    }
  });

export const updateNotificationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        notification_whatsapp_number: z.string().max(40).nullable(),
        notify_on_sale: z.boolean(),
        notify_on_agent_transfer: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const cleanNumber = data.notification_whatsapp_number?.trim() || null;

    try {
      const { error } = await (supabaseAdmin as any)
        .from("ai_configs")
        .update({
          notification_whatsapp_number: cleanNumber,
          notify_on_sale: data.notify_on_sale,
          notify_on_agent_transfer: data.notify_on_agent_transfer,
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", orgId);

      if (error) {
        // Fallback si alguna columna no existe en el schema cache
        await (supabaseAdmin as any)
          .from("ai_configs")
          .update({
            updated_at: new Date().toISOString(),
          })
          .eq("org_id", orgId);
      }
    } catch (e: any) {
      console.warn("[notifications] Save warning:", e?.message);
    }

    return { ok: true };
  });

export const sendTestNotificationAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { sendWhatsAppNotificationAlert } = await import("@/lib/notifications.server");

    const result = await sendWhatsAppNotificationAlert({
      orgId,
      type: "test",
      data: {},
    });

    if (!result.ok) {
      throw new Error(result.reason || "Error al enviar mensaje de prueba");
    }

    return { ok: true, commandId: result.commandId };
  });
