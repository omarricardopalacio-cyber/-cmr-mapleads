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

export const listNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ contactId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: notes } = await supabaseAdmin
      .from("notes")
      .select("id, content, created_at, user_id")
      .eq("contact_id", data.contactId)
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    return { notes: notes ?? [] };
  });

export const createNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        contactId: z.string().uuid(),
        content: z.string().min(1).max(2000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: note, error } = await supabaseAdmin
      .from("notes")
      .insert({
        org_id: orgId,
        contact_id: data.contactId,
        user_id: context.userId,
        content: data.content,
      })
      .select("id, content, created_at, user_id")
      .single();
    if (error) throw new Error(error.message);
    return { note };
  });

export const deleteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ noteId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("notes")
      .delete()
      .eq("id", data.noteId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
