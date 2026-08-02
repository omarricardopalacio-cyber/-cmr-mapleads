// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { storagePathFromMediaUrl } from "@/lib/media";
import { sanitizeMessageText } from "@/lib/message-text";
import { ensureUserOrg } from "@/lib/org-helpers";
import { insertMessagesSafe } from "@/lib/message-insert.server";

/**
 * Borra del bucket "media" los archivos referenciados por los mensajes indicados.
 * Evita archivos huerfanos cuando se eliminan mensajes/threads/contactos.
 * Solo borra rutas que pertenecen a ESTE proyecto (las que se pueden resolver).
 */
async function deleteMediaFilesForMessages(
  orgId: string,
  threadId?: string
): Promise<number> {
  let query = supabaseAdmin
    .from("messages")
    .select("media")
    .eq("org_id", orgId)
    .not("media", "is", null);
  if (threadId) query = query.eq("thread_id", threadId);

  const { data, error } = await query;
  if (error || !data) return 0;

  const paths = new Set<string>();
  for (const row of data as Array<{ media: unknown }>) {
    let media = row.media as Record<string, unknown> | string | null;
    if (typeof media === "string") {
      try { media = JSON.parse(media); } catch { media = null; }
    }
    if (!media || typeof media !== "object") continue;
    const m = media as Record<string, unknown>;
    const storagePath = typeof m.storagePath === "string" ? m.storagePath : null;
    const url = typeof m.url === "string" ? m.url : null;
    const path = storagePath || (url ? storagePathFromMediaUrl(url) : null);
    if (path) paths.add(path);
  }

  const all = [...paths];
  let removed = 0;
  for (let i = 0; i < all.length; i += 100) {
    const chunk = all.slice(i, i + 100);
    const { error: rmErr } = await supabaseAdmin.storage.from("media").remove(chunk);
    if (!rmErr) removed += chunk.length;
  }
  return removed;
}

/** Quita base64 gigantes del JSON de media (provocaban timeout al listar chats). */
function slimMediaForClient(
  media: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!media || typeof media !== "object") return media;
  const out: Record<string, unknown> = { ...media };
  delete out.base64;
  delete out.body;
  delete out.data;
  // data: URIs enormes tampoco viajan al cliente
  if (typeof out.url === "string" && out.url.startsWith("data:")) {
    out.url = null;
    out.missing_media = true;
  }
  return out;
}

async function signMessageMedia(
  media: Record<string, unknown> | null
): Promise<Record<string, unknown> | null> {
  const slim = slimMediaForClient(media);
  if (!slim || typeof slim !== "object") return slim;
  const url = typeof slim.url === "string" ? slim.url : null;
  if (!url) return slim;

  // Si la URL ya es pública, no necesitamos firmarla. Esto previene que cambie la firma cada 3 segundos,
  // deteniendo el parpadeo/titileo de videos/imágenes y eliminando los timeouts en la base de datos.
  if (url.includes("/storage/v1/object/public/")) {
    return slim;
  }

  const path = storagePathFromMediaUrl(url);
  if (!path) return slim;
  try {
    const { data, error } = await supabaseAdmin.storage.from("media").createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return slim;
    return { ...slim, url: data.signedUrl };
  } catch {
    return slim;
  }
}

export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);

    // La autorización ya quedó validada por requireSupabaseAuth + ensureUserOrg.
    // Consultar con admin evita evaluar is_member() por cada mensaje y elimina
    // el doble intento RLS→admin que excedía el timeout cuando Supabase estaba cargado.
    const { data: threadRow, error: threadErr } = await supabaseAdmin
      .from("threads")
      .select("id, contact_id, session_id, ai_enabled, purchase_intent, channel, contacts:contact_id(id, display_name, wa_id, phone, profile_picture_url)")
      .eq("id", data.threadId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (threadErr) {
      console.error("[listMessages] thread query error:", threadErr.message);
      throw new Error(`Thread query failed: ${threadErr.message}`);
    }
    if (!threadRow) throw new Error("Thread not found");

    const { data: messageRows, error: msgErr } = await supabaseAdmin
      .from("messages")
      .select("id, direction, text, sent_at, media")
      .eq("thread_id", data.threadId)
      .eq("org_id", orgId)
      .order("sent_at", { ascending: false })
      .limit(200);
    if (msgErr) {
      console.error("[listMessages] messages query error:", msgErr.message);
      throw new Error(`Messages query failed: ${msgErr.message}`);
    }
    const messages = (messageRows ?? []).slice().reverse();

    const contact = Array.isArray(threadRow.contacts) ? threadRow.contacts[0] : threadRow.contacts;
    console.log("[listMessages] thread:", threadRow.id, "contact:", contact?.display_name ?? contact?.wa_id ?? "none", "messages:", messages.length);

    // Firmar media en lotes pequeños (Promise.all de 200 firmas = timeout Netlify)
    const rawMsgs = messages;
    const enriched: typeof rawMsgs = [];
    const BATCH = 15;
    for (let i = 0; i < rawMsgs.length; i += BATCH) {
      const chunk = rawMsgs.slice(i, i + BATCH);
      const signed = await Promise.all(
        chunk.map(async (m) => ({
          ...m,
          text: sanitizeMessageText(m.text),
          media: await signMessageMedia(m.media as Record<string, unknown> | null),
        })),
      );
      enriched.push(...signed);
    }

    return {
      thread: {
        id: threadRow.id,
        sessionId: threadRow.session_id,
        contactId: threadRow.contact_id,
        aiEnabled: (threadRow as any).ai_enabled !== false, // default true si es null/undefined
        purchase_intent: (threadRow as any).purchase_intent ?? null,
        channel: (threadRow as any).channel || "whatsapp",
        contact: {
          displayName: contact?.display_name ?? contact?.phone ?? contact?.wa_id?.replace(/@lid$/, "").replace(/@c\.us$/, "") ?? null,
          waId: contact?.wa_id ?? null,
          phone: contact?.phone ?? null,
          profilePictureUrl: contact?.profile_picture_url ?? null,
        },
      },
      messages: enriched as Array<{
        id: string;
        direction: string;
        text: string | null;
        sent_at: string;
        media: Record<string, unknown> | null;
      }>,
    };
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        threadId: z.string().uuid(),
        text: z.string().max(4000).default(""),
        media_url: z.string().url().nullable().optional(),
        media_base64: z.string().max(35_000_000).nullable().optional(),
        media_storage_path: z.string().max(500).nullable().optional(),
        mime_type: z.string().max(100).nullable().optional(),
        caption: z.string().max(2000).nullable().optional(),
      })
      .refine(
        (v) => v.text.trim().length > 0 || v.media_url || v.media_base64 || v.media_storage_path,
        { message: "Message text or media is required" }
      )
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: thread } = await supabaseAdmin
      .from("threads")
      .select("id, session_id, channel, contact_id, contacts(id, wa_id, phone)")
      .eq("id", data.threadId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!thread) throw new Error("Thread not found");
    const contact = Array.isArray(thread.contacts) ? thread.contacts[0] : thread.contacts;
    const contactIdForLearning =
      (contact as any)?.id || (thread as any).contact_id || null;
    const channel = (thread as any).channel || "whatsapp";

    const displayText = sanitizeMessageText(
      data.caption || data.text,
      data.caption
    );
    const messageMedia =
      data.media_url && data.mime_type
        ? { url: data.media_url, mimeType: data.mime_type, mime_type: data.mime_type }
        : data.media_url
          ? { url: data.media_url }
          : null;

    // Canal WEB: solo DB (Realtime); sin engine_commands
    if (channel === "web") {
      const { error: insertErr } = await insertMessagesSafe({
        org_id: orgId,
        thread_id: data.threadId,
        direction: "out",
        text: displayText,
        media: messageMedia,
        wa_message_id: `web-agent-${crypto.randomUUID()}`,
        sent_at: new Date().toISOString(),
        source: "agent",
        raw: { channel: "web", source: "agent" },
      });
      if (insertErr) throw new Error(`Error al guardar mensaje: ${insertErr.message}`);
      await supabaseAdmin
        .from("threads")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", data.threadId)
        .eq("org_id", orgId);
      // Aprendizaje por producto (fire-and-forget)
      import("@/lib/product-learning.server")
        .then(({ maybeQualifyProductLearning }) =>
          maybeQualifyProductLearning({
            orgId,
            threadId: data.threadId,
            contactId: contactIdForLearning,
          }),
        )
        .catch(() => {});
      return { commandId: null, channel: "web" };
    }

    // Preferir wa_id (puede ser LID como 123@lid) porque WhatsApp Web puede enviar usando LIDs.
    // Solo usar phone si wa_id no es un JID válido.
    const target = contact?.wa_id && contact.wa_id.includes('@')
      ? contact.wa_id
      : contact?.phone ?? contact?.wa_id;
    if (!target) throw new Error("Contact missing wa_id");
    const chatId = /@/.test(target) ? target : `${target}@c.us`;

    // Payload liviano: no descargar/reconvertir media dentro de la función.
    // La extensión resuelve la URL una sola vez al ejecutar el comando.
    const payload: Record<string, unknown> = {
      chatId,
      text: data.text.trim() || data.caption || "",
    };

    if (data.media_base64) {
      const raw = data.media_base64.trim();
      payload.media = raw.startsWith("data:")
        ? raw
        : `data:${data.mime_type || "application/octet-stream"};base64,${raw}`;
    } else if (data.media_url) {
      payload.mediaUrl = data.media_url;
    } else if (data.media_storage_path) {
      payload.mediaUrl = supabaseAdmin.storage
        .from("media")
        .getPublicUrl(data.media_storage_path).data.publicUrl;
    }
    if (data.mime_type) payload.mimeType = data.mime_type;
    if (data.caption || data.text) payload.caption = data.caption || data.text;

    // Generar un ID para el comando para poder usarlo en el wa_message_id
    const cmdId = crypto.randomUUID();

    payload.source = "agent";

    const { error: insertErr } = await insertMessagesSafe({
      org_id: orgId,
      thread_id: data.threadId,
      direction: "out",
      text: displayText,
      media: messageMedia,
      wa_message_id: `pending-${cmdId}`,
      sent_at: new Date().toISOString(),
      source: "agent",
    });
    
    if (insertErr) {
      console.error("[sendMessage] Error inserting pending message:", insertErr);
      throw new Error(`Error al guardar mensaje pendiente: ${insertErr.message}`);
    }

    if (!thread.session_id) throw new Error("Thread missing WhatsApp session");

    const { data: cmd, error } = await (supabaseAdmin as any)
      .from("engine_commands")
      .insert({
        id: cmdId,
        org_id: orgId,
        session_id: thread.session_id,
        type: "SEND_MESSAGE",
        payload,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !cmd) throw new Error(error?.message || "insert failed");

    await supabaseAdmin
      .from("threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", data.threadId)
      .eq("org_id", orgId);

    import("@/lib/product-learning.server")
      .then(({ maybeQualifyProductLearning }) =>
        maybeQualifyProductLearning({
          orgId,
          threadId: data.threadId,
          contactId: contactIdForLearning,
        }),
      )
      .catch(() => {});

    return { commandId: cmd.id, channel: "whatsapp" };
  });


export const sendDirectMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        sessionId: z.string().uuid(),
        chatId: z.string().min(3).max(120),
        text: z.string().min(1).max(4000),
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: session } = await supabaseAdmin
      .from("wa_sessions")
      .select("id")
      .eq("id", data.sessionId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!session) throw new Error("Session not found");
    const chatId = data.chatId.includes("@") ? data.chatId : `${data.chatId}@c.us`;
    const { data: cmd, error } = await supabaseAdmin
      .from("engine_commands")
      .insert({
        org_id: orgId,
        session_id: session.id,
        type: "send_message",
        payload: { chatId, text: data.text },
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !cmd) throw new Error(error?.message || "insert failed");
    return { commandId: cmd.id };

  });

export const toggleAiEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid(), aiEnabled: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    try {
      await supabaseAdmin.from("threads").update({ ai_enabled: data.aiEnabled } as unknown as Record<string, unknown>).eq("id", data.threadId).eq("org_id", orgId);
    } catch {
      // Columna ai_enabled puede no existir en BD; ignorar error
    }
    return { ok: true };
  });

export const clearThreadMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: thread } = await supabaseAdmin
      .from("threads")
      .select("id, contact_id")
      .eq("id", data.threadId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!thread) throw new Error("Thread not found");

    // La FK messages.thread_id tiene ON DELETE CASCADE. Borrar el thread es
    // atómico y rápido; recorrer Storage antes podía dejar la petición colgada
    // hasta el Inactivity Timeout. Se prioriza que el chat desaparezca de BD.
    const { error: threadError } = await supabaseAdmin
      .from("threads")
      .delete()
      .eq("id", data.threadId)
      .eq("org_id", orgId);
    if (threadError) throw new Error(threadError.message);

    if (thread.contact_id) {
      const { count, error: countError } = await supabaseAdmin
        .from("threads")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("contact_id", thread.contact_id);
      if (countError) throw new Error(countError.message);
      if ((count ?? 0) === 0) {
        const { error: contactError } = await supabaseAdmin
          .from("contacts")
          .delete()
          .eq("id", thread.contact_id)
          .eq("org_id", orgId);
        if (contactError) throw new Error(contactError.message);
      }
    }

    return { success: true };
  });

// ADVERTENCIA: Esta función es extremadamente destructiva.
// Borra TODOS los mensajes, threads y contactos de la organización completa.
export const clearAllChats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);

    // Borrar primero todos los archivos de Storage de la organizacion (evita huerfanos)
    await deleteMediaFilesForMessages(orgId);

    const { error: messagesError } = await supabaseAdmin
      .from("messages")
      .delete()
      .eq("org_id", orgId);
    if (messagesError) throw new Error(messagesError.message);

    const { error: threadsError } = await supabaseAdmin
      .from("threads")
      .delete()
      .eq("org_id", orgId);
    if (threadsError) throw new Error(threadsError.message);

    const { error: contactsError } = await supabaseAdmin
      .from("contacts")
      .delete()
      .eq("org_id", orgId);
    if (contactsError) throw new Error(contactsError.message);

    return { success: true };
  });

export const uploadMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      base64: z.string(),
      fileName: z.string(),
      mimeType: z.string(),
    }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const path = `${orgId}/${Date.now()}_${data.fileName}`;
    try {
      const binaryString = atob(data.base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const { error: upErr } = await supabaseAdmin.storage
        .from("media")
        .upload(path, bytes, { contentType: data.mimeType, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = supabaseAdmin.storage.from("media").getPublicUrl(path);
      return { url: urlData.publicUrl, storagePath: path };
    } catch (err: unknown) {
      throw new Error(`Upload failed: ${(err as Error).message}`);
    }
  });

export const assignThreadToAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ threadId: z.string().uuid(), agentUserId: z.string().uuid().nullable().optional() }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("threads")
      .update({ assigned_to_user_id: data.agentUserId ?? null })
      .eq("id", data.threadId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const getMyOrgId = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return await ensureUserOrg(context.userId);
  });

export const syncThreadMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: thread } = await supabaseAdmin
      .from("threads")
      .select("id, org_id")
      .eq("id", data.threadId)
      .maybeSingle();
    if (!thread) throw new Error("Thread not found");
    const threadOrgId = thread.org_id ?? orgId;

    const { data: orphanMsgs, error: countErr } = await supabaseAdmin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", data.threadId)
      .or("org_id.is.null,org_id.neq." + threadOrgId);
    if (countErr) throw new Error(countErr.message);

    const { error: updErr } = await supabaseAdmin
      .from("messages")
      .update({ org_id: threadOrgId })
      .eq("thread_id", data.threadId)
      .or("org_id.is.null,org_id.neq." + threadOrgId);
    if (updErr) throw new Error(updErr.message);

    return { success: true, synced: (orphanMsgs as unknown as Array<{ id: string }> | null)?.length ?? 0 };
  });
