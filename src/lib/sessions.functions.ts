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
      .select(
        "id, label, status, last_heartbeat_at, last_sync_at, created_at, session_token, me_wa_id, phone_number, device_name, battery_level, platform, default_agent_id, default_flow_id"
      )
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
      .select("id, label, status, session_token, me_wa_id")
      .single();
    if (error) throw new Error(error.message);
    return { session: row };
  });

export const updateSessionMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        sessionId: z.string().uuid(),
        meWaId: z.string().max(32).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const normalized = data.meWaId ? data.meWaId.replace(/\D/g, "") : null;
    const { error } = await supabaseAdmin
      .from("wa_sessions")
      .update({ me_wa_id: normalized || null })
      .eq("id", data.sessionId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { ok: true, meWaId: normalized };
  });

export const updateSessionConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        sessionId: z.string().uuid(),
        defaultAgentId: z.string().uuid().nullable(),
        defaultFlowId: z.string().uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { error } = await supabaseAdmin
      .from("wa_sessions")
      .update({
        default_agent_id: data.defaultAgentId,
        default_flow_id: data.defaultFlowId,
      })
      .eq("id", data.sessionId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
