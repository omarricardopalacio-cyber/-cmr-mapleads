import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function getUserOrg(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("No organization");
  return data.org_id;
}

export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: thread } = await supabaseAdmin
      .from("threads")
      .select("id, contact_id, session_id, contacts(display_name, wa_id, phone)")
      .eq("id", data.threadId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!thread) throw new Error("Thread not found");
    const { data: messages } = await supabaseAdmin
      .from("messages")
      .select("id, direction, text, sent_at, media")
      .eq("thread_id", data.threadId)
      .order("sent_at", { ascending: true })
      .limit(500);
    const contact = Array.isArray(thread.contacts) ? thread.contacts[0] : thread.contacts;
    return {
      thread: {
        id: thread.id,
        sessionId: thread.session_id,
        contact: {
          displayName: contact?.display_name ?? contact?.phone ?? contact?.wa_id ?? null,
          waId: contact?.wa_id ?? null,
        },
      },
      messages: messages ?? [],
    };
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ threadId: z.string().uuid(), text: z.string().min(1).max(4000) }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: thread } = await supabaseAdmin
      .from("threads")
      .select("id, session_id, contacts(wa_id)")
      .eq("id", data.threadId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!thread) throw new Error("Thread not found");
    const contact = Array.isArray(thread.contacts) ? thread.contacts[0] : thread.contacts;
    const waId = contact?.wa_id;
    if (!waId) throw new Error("Contact missing wa_id");
    // Build a proper chatId. If wa_id is just digits, suffix @c.us.
    const chatId = /@/.test(waId) ? waId : `${waId}@c.us`;


    const { data: cmd, error } = await supabaseAdmin
      .from("engine_commands")
      .insert({
        org_id: orgId,
        session_id: thread.session_id,
        type: "send_message",
        payload: { chatId, text: data.text },
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
    const orgId = await getUserOrg(context.userId);
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

export const clearThreadMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
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
    const orgId = await getUserOrg(context.userId);

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


