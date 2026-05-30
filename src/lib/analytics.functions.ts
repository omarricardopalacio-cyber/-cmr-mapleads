import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureUserOrg } from "@/lib/org-helpers";
import { z } from "zod";

const DAYS_SCHEMA = z.object({ days: z.number().int().min(1).max(365).optional() });

function getSince(days?: number) {
  const d = days ?? 30;
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}

export const getDashboardMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => DAYS_SCHEMA.parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await ensureUserOrg(context.userId);
    const since = getSince(data.days);

    const [
      contactsRes,
      threadsRes,
      messagesRes,
      aiActionsRes,
      aiTransferRes,
      stagesRes,
      funnelRes,
      dailyMessagesRes,
      assignedRes,
      topActionsRes,
    ] = await Promise.all([
      supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabaseAdmin.from("threads").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      supabaseAdmin.from("messages").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("created_at", since),
      supabaseAdmin.from("ai_actions_log").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("created_at", since),
      supabaseAdmin.from("ai_actions_log").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("action_name", "transfer_to_human").gte("created_at", since),
      (supabaseAdmin as any).from("pipeline_stages").select("id, name, color, position").eq("org_id", orgId).order("position", { ascending: true }),
      (supabaseAdmin as any)
        .from("contacts")
        .select("pipeline_stage_id, pipeline_stages!inner(name, color, position)")
        .eq("org_id", orgId)
        .not("pipeline_stage_id", "is", null),
      supabaseAdmin
        .from("messages")
        .select("direction, created_at")
        .eq("org_id", orgId)
        .gte("created_at", since)
        .order("created_at", { ascending: true }),
      supabaseAdmin.from("threads").select("assigned_to_user_id").eq("org_id", orgId).not("assigned_to_user_id", "is", null),
      supabaseAdmin
        .from("ai_actions_log")
        .select("action_name, action_details")
        .eq("org_id", orgId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const totalContacts = contactsRes.count ?? 0;
    const totalThreads = threadsRes.count ?? 0;
    const totalMessages = messagesRes.count ?? 0;
    const totalAiActions = aiActionsRes.count ?? 0;
    const totalTransfers = aiTransferRes.count ?? 0;

    const stages = (stagesRes.data ?? []) as Array<{ id: string; name: string; color: string; position: number }>;

    const funnelMap = new Map<string, number>();
    for (const s of stages) funnelMap.set(s.id, 0);
    const funnelRows = (funnelRes.data ?? []) as Array<{ pipeline_stage_id: string; pipeline_stages?: { name: string; color: string; position: number } | Array<{ name: string; color: string; position: number }> }>;
    for (const row of funnelRows) {
      if (row.pipeline_stage_id) {
        funnelMap.set(row.pipeline_stage_id, (funnelMap.get(row.pipeline_stage_id) ?? 0) + 1);
      }
    }
    const funnel = stages.map((s) => ({
      name: s.name,
      color: s.color,
      count: funnelMap.get(s.id) ?? 0,
    }));

    const dailyMap = new Map<string, { in: number; out: number }>();
    const msgRows = (dailyMessagesRes.data ?? []) as Array<{ direction: string; created_at: string }>;
    for (const m of msgRows) {
      const day = m.created_at.slice(0, 10);
      const entry = dailyMap.get(day) ?? { in: 0, out: 0 };
      if (m.direction === "in") entry.in += 1;
      else if (m.direction === "out") entry.out += 1;
      dailyMap.set(day, entry);
    }
    const dailyMessages = Array.from(dailyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, vals]) => ({ date, received: vals.in, sent: vals.out }));

    const assignedThreads = (assignedRes.data ?? []) as Array<{ assigned_to_user_id: string }>;
    const agentMap = new Map<string, number>();
    for (const t of assignedThreads) {
      agentMap.set(t.assigned_to_user_id, (agentMap.get(t.assigned_to_user_id) ?? 0) + 1);
    }

    const actionCounts = new Map<string, number>();
    const actionDetails = new Map<string, string>();
    for (const a of (topActionsRes.data ?? []) as Array<{ action_name: string; action_details: string }>) {
      actionCounts.set(a.action_name, (actionCounts.get(a.action_name) ?? 0) + 1);
      if (!actionDetails.has(a.action_name)) actionDetails.set(a.action_name, a.action_details);
    }
    const topActions = Array.from(actionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count, detail: actionDetails.get(name) ?? "" }));

    return {
      kpis: {
        totalContacts,
        totalThreads,
        totalMessages,
        aiActions: totalAiActions,
        aiTransferRate: totalAiActions > 0 ? Math.round((totalTransfers / totalAiActions) * 100) : 0,
      },
      funnel,
      dailyMessages,
      agentChats: Array.from(agentMap.entries()).map(([userId, count]) => ({ userId, count })),
      topAiActions: topActions,
    };
  });

export const getAgentDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await ensureUserOrg(context.userId);
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role, profiles:user_id(display_name, email)")
      .eq("org_id", orgId);
    const members = (data ?? []).map((m: unknown) => {
      const raw = m as Record<string, unknown>;
      const profile = Array.isArray(raw.profiles) ? raw.profiles[0] : (raw.profiles as Record<string, unknown> | undefined);
      return {
        id: raw.user_id as string,
        displayName: (profile?.display_name as string) || (profile?.email as string) || "Usuario",
      };
    });
    return { members };
  });
