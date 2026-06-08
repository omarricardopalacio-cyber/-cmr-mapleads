// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { convertUrlToBase64, storagePathFromMediaUrl } from "@/lib/media";
import { sanitizeMessageText } from "@/lib/message-text";
import { ensureUserOrg } from "@/lib/org-helpers";

async function downloadMediaFromStorage(
  path: string
): Promise<{ base64: string; mimeType: string }> {
  const { data, error } = await supabaseAdmin.storage.from("media").download(path);
  if (error || !data) throw new Error(error?.message || "Storage download failed");
  const arrayBuffer = await data.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = data.type || "application/octet-stream";
  return { base64, mimeType };
}

async function resolveMediaForCommand(opts: {
  media_url?: string | null;
  media_base64?: string | null;
  media_storage_path?: string | null;
  mime_type?: string | null;
  caption?: string | null;
  text?: string;
}): Promise<{ media?: string; caption?: string }> {
  const caption = opts.caption || opts.text || undefined;

  if (opts.media_base64) {
    const raw = opts.media_base64.trim();
    const media = raw.startsWith("data:")
      ? raw
      : `data:${opts.mime_type || "application/octet-stream"};base64,${raw}`;
    return { media, caption };
  }

  const storagePath =
    opts.media_storage_path ||
    (opts.media_url ? storagePathFromMediaUrl(opts.media_url) : null);

  if (storagePath) {
    const { base64, mimeType } = await downloadMediaFromStorage(storagePath);
    return {
      media: `data:${opts.mime_type || mimeType};base64,${base64}`,
      caption,
    };
  }

  if (opts.media_url) {
    const { base64, mimeType } = await convertUrlToBase64(opts.media_url);
    return {
      media: `data:${opts.mime_type || mimeType};base64,${base64}`,
      caption,
    };
  }

  return {};
}

async function signMessageMedia(
  media: Record<string, unknown> | null
): Promise<Record<string, unknown> | null> {
  if (!media || typeof media !== "object") return media;
  const url = typeof media.url === "string" ? media.url : null;
  if (!url) return media;

  // Si la URL ya es pública, no necesitamos firmarla. Esto previene que cambie la firma cada 3 segundos,
  // deteniendo el parpadeo/titileo de videos/imágenes y eliminando los timeouts en la base de datos.
  if (url.includes("/storage/v1/object/public/")) {
    return media;
  }

  const path = storagePathFromMediaUrl(url);
  if (!path) return media;
  const { data, error } = await supabaseAdmin.storage.from("media").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return media;
  return { ...media, url: data.signedUrl };
}

export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);

    // NIVEL 3: Usar context.supabase (cliente con JWT del usuario, respeta RLS) como PRIMARIA
    const userSupabase = context.supabase;

    const { data: thread, error: threadErr } = await userSupabase
      .from("threads")
      .select("id, contact_id, session_id, ai_enabled, purchase_intent, contacts:contact_id(id, display_name, wa_id, phone, profile_picture_url)")
      .eq("id", data.threadId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (threadErr) {
      console.error("[listMessages] thread query error (RLS):", threadErr.message);
    }

    let threadRow = thread;
    let messages: any[] | null = null;
    let msgErr: any = null;

    if (threadRow) {
      const msgRes = await userSupabase
        .from("messages")
        .select("id, direction, text, sent_at, media")
        .eq("thread_id", data.threadId)
        .eq("org_id", orgId)
        .order("sent_at", { ascending: true })
        .limit(500);
      messages = msgRes.data;
      msgErr = msgRes.error;
      if (msgErr) {
        console.error("[listMessages] messages query error (RLS):", msgErr.message);
      }
    }

    // Fallback: si el cliente RLS falló o devolvió vacío, usar supabaseAdmin
    const useFallback = !threadRow || !messages || messages.length === 0;
    if (useFallback) {
      console.warn("[listMessages] FALLBACK a supabaseAdmin. threadRow:", !!threadRow, "messagesCount:", messages?.length ?? 0);
      const { data: adminThread } = await supabaseAdmin
        .from("threads")
        .select("id, contact_id, session_id, ai_enabled, purchase_intent, contacts:contact_id(id, display_name, wa_id, phone, profile_picture_url)")
        .eq("id", data.threadId)
        .eq("org_id", orgId)
        .maybeSingle();
      threadRow = adminThread ?? threadRow;

      if (threadRow) {
        const { data: adminMsgs, error: adminErr } = await supabaseAdmin
          .from("messages")
          .select("id, direction, text, sent_at, media")
          .eq("thread_id", data.threadId)
          .order("sent_at", { ascending: true })
          .limit(500);
        if (adminErr) {
          console.error("[listMessages] messages query error (admin):", adminErr.message);
          throw new Error(`Messages query failed: ${adminErr.message}`);
        }
        messages = adminMsgs ?? [];
      }
    }

    if (!threadRow) throw new Error("Thread not found");

    const contact = Array.isArray(threadRow.contacts) ? threadRow.contacts[0] : threadRow.contacts;
    console.log("[listMessages] thread:", threadRow.id, "contact:", contact?.display_name ?? contact?.wa_id ?? "none", "messages:", (messages ?? []).length, "fallback:", useFallback);
    const enriched = await Promise.all(
      (messages ?? []).map(async (m) => ({
        ...m,
        text: sanitizeMessageText(m.text),
        media: await signMessageMedia(m.media as Record<string, unknown> | null),
      }))
    );

    return {
      thread: {
        id: threadRow.id,
        sessionId: threadRow.session_id,
        contactId: threadRow.contact_id,
        aiEnabled: (threadRow as any).ai_enabled !== false, // default true si es null/undefined
        purchase_intent: (threadRow as any).purchase_intent ?? "pending",
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
      .select("id, session_id, contacts(wa_id, phone)")
      .eq("id", data.threadId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!thread) throw new Error("Thread not found");
    const contact = Array.isArray(thread.contacts) ? thread.contacts[0] : thread.contacts;
    // Preferir wa_id (puede ser LID como 123@lid) porque WhatsApp Web puede enviar usando LIDs.
    // Solo usar phone si wa_id no es un JID válido.
    const target = contact?.wa_id && contact.wa_id.includes('@')
      ? contact.wa_id
      : contact?.phone ?? contact?.wa_id;
    if (!target) throw new Error("Contact missing wa_id");
    const chatId = /@/.test(target) ? target : `${target}@c.us`;

    // Build payload and resolve media (including signed URLs)
    const payload: Record<string, unknown> = {
      chatId,
      text: data.text.trim() || data.caption || "",
    };

    // Use helper to resolve media URL or base64, handling signed URLs for storage paths
    const resolved = await resolveMediaForCommand({
      media_url: data.media_url,
      media_base64: data.media_base64,
      media_storage_path: data.media_storage_path,
      mime_type: data.mime_type,
      caption: data.caption,
      text: data.text,
    });

    if (resolved.media) {
      if (resolved.media.startsWith("data:")) {
        payload.media = resolved.media;
      } else {
        payload.mediaUrl = resolved.media;
      }
      if (resolved.caption) payload.caption = resolved.caption;
    }


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

    // Generar un ID para el comando para poder usarlo en el wa_message_id
    const cmdId = crypto.randomUUID();

    const { error: insertErr } = await supabaseAdmin.from("messages").insert({
      org_id: orgId,
      thread_id: data.threadId,
      direction: "out",
      text: displayText,
      media: messageMedia,
      wa_message_id: `pending-${cmdId}`,
      sent_at: new Date().toISOString(),
    });
    
    if (insertErr) {
      console.error("[sendMessage] Error inserting pending message:", insertErr);
      throw new Error(`Error al guardar mensaje pendiente: ${insertErr.message}`);
    }

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

    return { commandId: cmd.id };
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

    const { error: messagesError } = await supabaseAdmin
      .from("messages")
      .delete()
      .eq("thread_id", data.threadId)
      .eq("org_id", orgId);
    if (messagesError) throw new Error(messagesError.message);

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
