/**
 * Background Function (hasta 15 min): sobrevive al fin del ingest.
 * Invocada en fire-and-forget → espera debounce → llama /api/public/cron/ai-wake.
 */
export default async (req) => {
  let threadId = "";
  let delayMs = 1500;
  try {
    const body = await req.json();
    threadId = String(body?.threadId || "");
    delayMs = Math.min(Math.max(0, Number(body?.delayMs) || 1500), 8000);
  } catch {
    /* body opcional */
  }

  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const base =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    "https://cmrmaleads.netlify.app";
  const secret = process.env.CRON_SECRET || process.env.SUPABASE_ANON_KEY;
  if (!secret) {
    console.error("[ai-wake-bg] missing secret");
    return;
  }

  const qs = threadId
    ? `?threadId=${encodeURIComponent(threadId)}&delayMs=0`
    : "?delayMs=0";
  const url = `${String(base).replace(/\/$/, "")}/api/public/cron/ai-wake${qs}`;
  console.log("[ai-wake-bg] POST", url);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { apikey: secret },
    });
    const text = await res.text();
    console.log("[ai-wake-bg] status", res.status, text.slice(0, 400));
  } catch (err) {
    console.error("[ai-wake-bg] fetch failed:", err?.message || err);
  }
};

export const config = {
  background: true,
};
