/**
 * Inserción segura de messages: si falta la columna `source` (migración no aplicada),
 * reintenta sin ese campo para no tumbar el ingest ni el CRM.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MessageSource = "agent" | "ai" | "flow" | "unknown";

export function normalizeMessageSource(raw: unknown): MessageSource | null {
  const s = String(raw || "")
    .toLowerCase()
    .trim();
  if (s === "agent" || s === "ai" || s === "flow" || s === "unknown") return s;
  return null;
}

export function sourceFromEnginePayload(payload: unknown): MessageSource {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const explicit = normalizeMessageSource(p.source);
  if (explicit && explicit !== "unknown") return explicit;
  if (p.flowRunId || p.flow_run_id) return "flow";
  if (p.dedupeKey || p.dedupe_key) return "ai";
  return "unknown";
}

export async function resolveOutboundMessageSource(params: {
  orgId: string;
  sessionId?: string | null;
  text?: string | null;
  commandId?: string | null;
}): Promise<MessageSource> {
  try {
    if (params.commandId) {
      const { data: cmd } = await (supabaseAdmin as any)
        .from("engine_commands")
        .select("payload")
        .eq("id", params.commandId)
        .eq("org_id", params.orgId)
        .maybeSingle();
      if (cmd) return sourceFromEnginePayload(cmd.payload);
    }

    const text = String(params.text || "").trim();
    if (!text) return "unknown";

    const since = new Date(Date.now() - 180_000).toISOString();
    let q = (supabaseAdmin as any)
      .from("engine_commands")
      .select("payload, created_at")
      .eq("org_id", params.orgId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(25);
    if (params.sessionId) q = q.eq("session_id", params.sessionId);

    const { data: cmds } = await q;
    const match = (cmds || []).find((c: any) => {
      const p = c?.payload || {};
      const t = String(p.text || p.caption || "").trim();
      return t && t === text;
    });
    if (match) return sourceFromEnginePayload(match.payload);
  } catch (err) {
    console.warn(
      "[message-insert] resolveOutboundMessageSource",
      err instanceof Error ? err.message : err,
    );
  }
  return "unknown";
}

function isMissingSourceColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = String(error.message || "").toLowerCase();
  return (
    error.code === "42703" ||
    (msg.includes("source") && (msg.includes("column") || msg.includes("schema cache")))
  );
}

/** Inserta uno o varios mensajes; omite `source` si la columna aún no existe. */
export async function insertMessagesSafe(
  rows: Record<string, unknown> | Record<string, unknown>[],
): Promise<{ error: { message: string; code?: string } | null }> {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return { error: null };

  const { error } = await (supabaseAdmin as any).from("messages").insert(list);
  if (!error) return { error: null };

  if (!isMissingSourceColumn(error)) {
    console.error("[message-insert] insert failed:", error.message);
    return { error };
  }

  console.warn(
    "[message-insert] Columna messages.source ausente — reintento sin source. Ejecuta 20260730200000_product_learning.sql",
  );
  const stripped = list.map(({ source: _s, ...rest }) => rest);
  const retry = await (supabaseAdmin as any).from("messages").insert(stripped);
  if (retry.error) {
    console.error("[message-insert] retry failed:", retry.error.message);
    return { error: retry.error };
  }
  return { error: null };
}
