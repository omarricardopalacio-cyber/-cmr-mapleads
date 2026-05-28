import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomBytes } from "crypto";
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

export const listSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data } = await supabaseAdmin
      .from("wa_sessions")
      .select("id, label, status, last_heartbeat_at, created_at, session_token")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    return { sessions: data ?? [] };
  });

export const createSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ label: z.string().min(1).max(60) }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const token = randomBytes(32).toString("hex");
    const { data: row, error } = await supabaseAdmin
      .from("wa_sessions")
      .insert({
        org_id: orgId,
        label: data.label,
        session_token: token,
        created_by: context.userId,
      })
      .select("id, label, status, session_token")
      .single();
    if (error) throw new Error(error.message);
    return { session: row };
  });
