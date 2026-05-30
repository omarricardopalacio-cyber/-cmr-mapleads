import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { convertUrlToBase64 } from "@/lib/media";
import { ensureUserOrg } from "@/lib/org-helpers";

export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);

    // NIVEL 3: Usar context.supabase (cliente con JWT del usuario, respeta RLS) como PRIMARIA
    const userSupabase = context.supabase;

    const { data: thread, error: threadErr } = await userSupabase
      .from("threads")
      .select("id, contact_id, session_id, ai_enabled, contacts:contact_id(id, display_name, wa_id, phone)")
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
        .select("id, contact_id, session_id, ai_enabled, contacts:contact_id(id, display_name, wa_id, phone)")
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
    return {
      thread: {
        id: threadRow.id,
        sessionId: threadRow.session_id,
        contactId: threadRow.contact_id,
        aiEnabled: (threadRow as any).ai_enabled ?? true,
        contact: {
          displayName: contact?.display_name ?? contact?.phone ?? contact?.wa_id?.replace(/@lid$/, "").replace(/@c\.us$/, "") ?? null,
          waId: contact?.wa_id ?? null,
          phone: contact?.phone ?? null,
        },
      },
      messages: (messages ?? []) as Array<{
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
    z.object({ threadId: z.string().uuid(), text: z.string().min(1).max(4000), media_url: z.string().url().nullable().optional(), mime_type: z.string().max(100).nullable().optional() }).parse(d)
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
    const target = contact?.phone ?? contact?.wa_id;
    if (!target) throw new Error("Contact missing wa_id");
    const chatId = /@/.test(target) ? target : `${target}@c.us`;

    let payload: Record<string, unknown> = { chatId, text: data.text };
    let type = "send_message";

    if (data.media_url) {
      try {
        const { base64, mimeType } = await convertUrlToBase64(data.media_url);
        type = "send_media";
        payload = { chatId, base64, mimeType: data.mime_type || mimeType };
      } catch {
        throw new Error("Failed to convert media URL to base64");
      }
    }

    const { data: cmd, error } = await supabaseAdmin
      .from("engine_commands")
      .insert({
        org_id: orgId,
        session_id: thread.session_id,
        type,
        payload,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !cmd) throw new Error(error?.message || "insert failed");
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
    await supabaseAdmin.from("threads").update({ ai_enabled: data.aiEnabled } as any).eq("id", data.threadId).eq("org_id", orgId);
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
      return { url: urlData.publicUrl };
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
