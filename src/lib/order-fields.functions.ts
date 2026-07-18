import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "./org-helpers";

export const listOrderFields = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data, error } = await supabaseAdmin
      .from("order_fields")
      .select("*")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return { fields: data ?? [] };
  });

export const createOrderField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().min(1).max(100),
        display_order: z.number().int().min(0).default(0),
        is_required: z.boolean().default(true),
        field_type: z.string().max(50).default("text"),
      })
      .parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data: field, error } = await supabaseAdmin
      .from("order_fields")
      .insert({ ...data, org_id: orgId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { field };
  });

export const deleteOrderField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("order_fields")
      .delete()
      .eq("id", data.id)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
