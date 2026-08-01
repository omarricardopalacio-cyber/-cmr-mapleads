import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type NotificationType = "sale" | "transfer" | "test";

export interface AlertNotificationData {
  threadId?: string;
  contactName?: string | null;
  phoneNumber?: string | null;
  productName?: string | null;
  quantity?: number | string | null;
  totalPrice?: number | string | null;
  customerName?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  lastMessage?: string | null;
  formData?: Record<string, unknown> | null;
}

export async function getOrgNotificationConfig(orgId: string) {
  const { data } = await (supabaseAdmin as any)
    .from("ai_configs")
    .select("notification_whatsapp_number, notify_on_sale, notify_on_agent_transfer")
    .eq("org_id", orgId)
    .maybeSingle();

  return {
    notification_whatsapp_number: (data?.notification_whatsapp_number as string | null) || null,
    notify_on_sale: data?.notify_on_sale !== false,
    notify_on_agent_transfer: data?.notify_on_agent_transfer !== false,
  };
}

export async function sendWhatsAppNotificationAlert(opts: {
  orgId: string;
  type: NotificationType;
  data: AlertNotificationData;
}) {
  const { orgId, type, data } = opts;

  try {
    const config = await getOrgNotificationConfig(orgId);
    const targetNumber = config.notification_whatsapp_number?.trim();

    if (!targetNumber) {
      console.log(`[WhatsAppAlert] No target phone number set for org=${orgId}`);
      return { ok: false, reason: "No target phone number configured" };
    }

    if (type === "sale" && !config.notify_on_sale) {
      console.log(`[WhatsAppAlert] Sale notifications disabled for org=${orgId}`);
      return { ok: false, reason: "Sale notifications disabled" };
    }

    if (type === "transfer" && !config.notify_on_agent_transfer) {
      console.log(`[WhatsAppAlert] Agent transfer notifications disabled for org=${orgId}`);
      return { ok: false, reason: "Transfer notifications disabled" };
    }

    // Buscar sesión activa de WhatsApp para la organización
    const { data: session } = await (supabaseAdmin as any)
      .from("wa_sessions")
      .select("id, status")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session?.id) {
      console.warn(`[WhatsAppAlert] No active wa_session found for org=${orgId}`);
      return { ok: false, reason: "No active WhatsApp session found" };
    }

    // Limpiar número de teléfono (dejar solo dígitos)
    const cleanNumber = targetNumber.replace(/\D/g, "");
    if (!cleanNumber || cleanNumber.length < 7) {
      return { ok: false, reason: "Invalid phone number format" };
    }

    const destinationChatId = `${cleanNumber}@c.us`;
    let messageText = "";

    const phoneStr = data.phoneNumber || "No registrado";
    const nameStr = data.contactName || "Cliente";

    if (type === "sale") {
      const orderFieldsText: string[] = [];
      if (data.formData && typeof data.formData === "object") {
        for (const [key, val] of Object.entries(data.formData)) {
          if (val && typeof val !== "object") {
            orderFieldsText.push(`• *${key}*: ${val}`);
          }
        }
      }

      const extraDataBlock = orderFieldsText.length
        ? `\n\n📝 *DATOS REGISTRADOS:*\n${orderFieldsText.join("\n")}`
        : "";

      messageText = `🛍️ *¡NUEVA VENTA / PEDIDO CONFIRMADO!*

📱 *Cliente:* ${nameStr} (${phoneStr})
💬 *Chat ID:* ${data.threadId || "—"}

📦 *DETALLES:*
• *Producto:* ${data.productName || "Ver pedido"}
• *Cantidad:* ${data.quantity || "1"}
• *Total:* ${data.totalPrice || "—"}
• *Comprador:* ${data.customerName || nameStr}
• *Dirección/Ciudad:* ${data.address || ""} ${data.city || ""}
• *Notas:* ${data.notes || "Sin observaciones"}${extraDataBlock}

⏰ *Fecha:* ${new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })}`;
    } else if (type === "transfer") {
      messageText = `🚨 *ATENCIÓN REQUERIDA - REMITIDO A AGENTE*

El celular *${phoneStr}* (${nameStr}) necesita atención y fue remitido a un agente humano.

📌 *DETALLES DEL CHAT:*
• *Chat ID:* ${data.threadId || "—"}
• *Último mensaje / Motivo:* ${data.lastMessage || "Solicitud de asistencia humana"}
• *Estado:* IA desactivada para atención personalizada.

⏰ *Hora:* ${new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })}`;
    } else {
      // Prueba
      messageText = `🧪 *MENSAJE DE PRUEBA DE ALERTAS WHATSAPP*

Las notificaciones de ventas y transferencias a agente están funcionando correctamente para este número (*${cleanNumber}*).`;
    }

    const { data: cmd, error: cmdErr } = await (supabaseAdmin as any)
      .from("engine_commands")
      .insert({
        org_id: orgId,
        session_id: session.id,
        type: "SEND_MESSAGE",
        payload: {
          chatId: destinationChatId,
          text: messageText,
          source: "notification_system",
        },
        status: "pending",
      })
      .select("id")
      .single();

    if (cmdErr) {
      console.error("[WhatsAppAlert] Error queuing engine_command:", cmdErr);
      return { ok: false, reason: cmdErr.message };
    }

    return { ok: true, commandId: cmd?.id };
  } catch (err: any) {
    console.error("[WhatsAppAlert] Exception dispatching alert:", err);
    return { ok: false, reason: err?.message || "Unknown error" };
  }
}
