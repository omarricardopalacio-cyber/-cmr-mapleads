/**
 * Inserción segura de messages.
 * Por defecto NO escribe `source` (evita tumbar ingest si la migración
 * 20260730200000 no está aplicada). Si la columna existe, la rellena después.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MessageSource = "agent" | "ai" | "flow" | "unknown";

/** null = desconocido; true = falta columna; false = columna OK */
let sourceColumnMissing: boolean | null = null;

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
    error.code === "PGRST204" ||
    (msg.includes("source") &&
      (msg.includes("column") || msg.includes("schema cache") || msg.includes("could not find")))
  );
}

/** Inserta mensajes. Nunca bloquea el CRM por la columna source. */
export async function insertMessagesSafe(
  rows: Record<string, unknown> | Record<string, unknown>[],
): Promise<{ error: { message: string; code?: string } | null }> {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return { error: null };

  const sources = list.map((r) => r.source);
  const stripped = list.map(({ source: _s, ...rest }) => rest);

  // 1) Insertar SIEMPRE sin source (compatible con DB sin migración)
  const { data: inserted, error } = await (supabaseAdmin as any)
    .from("messages")
    .insert(stripped)
    .select("id");

  if (error) {
    console.error("[message-insert] insert failed:", error.message, error.code);
    return { error };
  }

  // 2) Best-effort: rellenar source si la columna existe
  if (sourceColumnMissing === true) return { error: null };

  const rowsWithId = (inserted || []) as Array<{ id: string }>;
  for (let i = 0; i < rowsWithId.length; i++) {
    const src = sources[i];
    if (src == null || src === "") continue;
    const id = rowsWithId[i]?.id;
    if (!id) continue;
    const { error: upErr } = await (supabaseAdmin as any)
      .from("messages")
      .update({ source: src })
      .eq("id", id);
    if (upErr) {
      if (isMissingSourceColumn(upErr)) {
        sourceColumnMissing = true;
        console.warn(
          "[message-insert] messages.source no existe. Ejecuta 20260730200000_product_learning.sql",
        );
      }
      break;
    }
    sourceColumnMissing = false;
  }

  return { error: null };
}
