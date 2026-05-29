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
      .select("id, contact_id, session_id, contacts(display_name, wa_id)")
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
        contact: { displayName: contact?.display_name ?? null, waId: contact?.wa_id ?? null },
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
    const chatId = contact?.wa_id;
    if (!chatId) throw new Error("Contact missing wa_id");

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
    if (error) throw new Error(error.message);
    return { commandId: cmd.id };
  });

