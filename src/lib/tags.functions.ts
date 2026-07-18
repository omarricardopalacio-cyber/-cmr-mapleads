import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { triggerFlows } from "./flow-trigger.server";

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

export const listTags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await supabaseAdmin
      .from("tags")
      .select("id, name, color, created_at")
      .eq("org_id", orgId)
      .order("name", { ascending: true });
    return { tags: data ?? [] };
  });

export const createTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().min(1).max(50),
        color: z.string().max(7).default("#E0E0E0"),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { data: tag, error } = await supabaseAdmin
      .from("tags")
      .insert({ org_id: orgId, name: data.name, color: data.color })
      .select("id, name, color")
      .single();
    if (error) throw new Error(error.message);
    return { tag };
  });

export const deleteTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tagId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("tags")
      .delete()
      .eq("id", data.tagId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

async function assertContactInOrg(contactId: string, orgId: string) {
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!contact) throw new Error("Contact not found");
}

export const listContactTags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ contactId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await assertContactInOrg(data.contactId, orgId);
    const { data: rows } = await supabaseAdmin
      .from("contact_tags")
      .select("tag_id, tags(id, name, color)")
      .eq("contact_id", data.contactId);
    const tags = (rows ?? [])
      .map((r) => (r as { tags?: { id: string; name: string; color: string } }).tags)
      .filter(Boolean);
    return { tags };
  });

export const addContactTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ contactId: z.string().uuid(), tagId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await assertContactInOrg(data.contactId, orgId);
    const { data: tag } = await supabaseAdmin
      .from("tags")
      .select("id")
      .eq("id", data.tagId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!tag) throw new Error("Tag not found");
    const { error } = await supabaseAdmin
      .from("contact_tags")
      .insert({ contact_id: data.contactId, tag_id: data.tagId });
    if (error && error.code !== "23505") throw new Error(error.message);
    
    // Disparar flujos (tag_added)
    if (!error || error.code === "23505") { // Si se insertó o ya existía, podríamos dispararlo (o solo si se insertó).
      triggerFlows({ orgId, contactId: data.contactId, triggerType: "tag_added", triggerValue: data.tagId }).catch(console.error);
    }
    
    return { success: true };
  });

export const removeContactTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ contactId: z.string().uuid(), tagId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    await assertContactInOrg(data.contactId, orgId);
    const { error } = await supabaseAdmin
      .from("contact_tags")
      .delete()
      .eq("contact_id", data.contactId)
      .eq("tag_id", data.tagId);
    if (error) throw new Error(error.message);
    
    // Disparar flujos (tag_removed)
    triggerFlows({ orgId, contactId: data.contactId, triggerType: "tag_removed", triggerValue: data.tagId }).catch(console.error);
    
    return { success: true };
  });

