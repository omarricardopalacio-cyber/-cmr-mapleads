// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { processDueAiReplies } from "@/lib/ai-reply.server";
import { processDueRuns } from "@/lib/flow-runner.server";

const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "Content-Type": "application/json" },
  });

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/**
 * Despertador liviano de IA/flujos (sin broadcasts).
 * Lo dispara ingest en fire-and-forget para no depender solo del cron cada minuto.
 */
export const Route = createFileRoute("/api/public/cron/ai-wake")({
  server: {
    handlers: {
      POST: handler,
      GET: handler,
    },
  },
});

async function handler({ request }: { request: Request }) {
  const CRON_SECRET = process.env.CRON_SECRET || process.env.SUPABASE_ANON_KEY;
  if (!CRON_SECRET) return json(500, { error: "missing secret" });
  const raw = request.headers.get("apikey") ?? request.headers.get("authorization") ?? "";
  const apikey = raw.replace(/^Bearer\s+/i, "").trim();
  if (!apikey || !timingSafeStringEqual(apikey, CRON_SECRET)) {
    return json(401, { error: "invalid apikey" });
  }

  const url = new URL(request.url);
  const threadId = url.searchParams.get("threadId") || undefined;
  const delayMs = Math.min(
    Math.max(0, Number(url.searchParams.get("delayMs") || 0) || 0),
    8000,
  );

  // Esperar el debounce aquí (esta request vive aparte del ingest)
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  try {
    await processDueRuns();
  } catch (err) {
    console.warn("[ai-wake] processDueRuns:", (err as Error)?.message);
  }

  let ai = { processed: 0, deferred: 0, skipped: 0 };
  try {
    ai = await processDueAiReplies({ threadId, limit: 20 });
  } catch (err) {
    console.warn("[ai-wake] processDueAiReplies:", (err as Error)?.message);
  }

  return json(200, { ok: true, ai, delayMs, threadId: threadId || null });
}
