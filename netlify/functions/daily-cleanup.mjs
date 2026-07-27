/**
 * Cron diario en Netlify: llama a /api/public/cron/cleanup del CRM.
 * Se ejecuta 1 vez al día (ver schedule en netlify.toml).
 */
export default async function handler() {
  const base = process.env.URL || process.env.DEPLOY_URL || "https://cmrmaleads.netlify.app";
  const secret = process.env.CRON_SECRET || process.env.SUPABASE_ANON_KEY;
  if (!secret) {
    console.error("[daily-cleanup] Falta CRON_SECRET o SUPABASE_ANON_KEY");
    return new Response(JSON.stringify({ error: "missing cron secret" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = `${base.replace(/\/$/, "")}/api/public/cron/cleanup`;
  console.log("[daily-cleanup] POST", url);

  const res = await fetch(url, {
    method: "POST",
    headers: { apikey: secret },
  });
  const body = await res.text();
  console.log("[daily-cleanup] status", res.status, body.slice(0, 800));

  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
