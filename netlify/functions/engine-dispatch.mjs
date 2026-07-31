/**
 * Cron cada minuto en Netlify: llama a /api/public/cron/dispatch
 * (scheduled messages, broadcasts y processDueRuns de flujos).
 * Respaldo si el pg_cron de Supabase falla o apunta a una URL vieja.
 */
export default async function handler() {
  const base =
    process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL ||
    "https://cmrmaleads.netlify.app";
  const secret = process.env.CRON_SECRET || process.env.SUPABASE_ANON_KEY;
  if (!secret) {
    console.error("[engine-dispatch] Falta CRON_SECRET o SUPABASE_ANON_KEY");
    return new Response(JSON.stringify({ error: "missing cron secret" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = `${String(base).replace(/\/$/, "")}/api/public/cron/dispatch`;
  console.log("[engine-dispatch] POST", url);

  const res = await fetch(url, {
    method: "POST",
    headers: { apikey: secret },
  });
  const body = await res.text();
  console.log("[engine-dispatch] status", res.status, body.slice(0, 800));

  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
