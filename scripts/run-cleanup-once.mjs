/**
 * Ejecuta la limpieza una vez (local). Usa las mismas reglas que /api/public/cron/cleanup.
 * node scripts/run-cleanup-once.mjs
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envText = fs.readFileSync(".env", "utf8");
function getEnv(key) {
  const m = envText.match(new RegExp(`^${key}="?([^"\n]+)"?`, "m"));
  return m ? m[1].trim() : "";
}

const url = getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const auditDays = Number(process.env.AUDIT_RETENTION_DAYS ?? "7");
const mediaDays = Number(process.env.MEDIA_RETENTION_DAYS ?? "5");

const sb = createClient(url, key, { auth: { persistSession: false } });
const auditCutoff = new Date(Date.now() - auditDays * 86400000).toISOString();
const mediaCutoff = new Date(Date.now() - mediaDays * 86400000).toISOString();

function storagePathFromMediaUrl(mediaUrl) {
  const m = String(mediaUrl).match(/\/storage\/v1\/object\/(?:public|sign)\/media\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

console.log("Limpieza manual:", { auditDays, mediaDays, auditCutoff, mediaCutoff });

let eventsDeleted = 0;
for (let i = 0; i < 50; i++) {
  const { data } = await sb.from("events").select("id").lt("created_at", auditCutoff).limit(10000);
  const ids = (data ?? []).map((r) => r.id);
  if (!ids.length) break;
  const { count } = await sb.from("events").delete({ count: "exact" }).in("id", ids);
  eventsDeleted += count ?? ids.length;
  if (ids.length < 10000) break;
}
console.log("events_deleted:", eventsDeleted);

for (const table of ["engine_commands", "ai_actions_log"]) {
  try {
    const q =
      table === "engine_commands"
        ? sb.from(table).delete({ count: "exact" }).in("status", ["acked", "failed", "delivered"]).lt("created_at", auditCutoff)
        : sb.from(table).delete({ count: "exact" }).lt("created_at", auditCutoff);
    const { count } = await q;
    console.log(`${table}_deleted:`, count ?? 0);
  } catch (e) {
    console.log(`${table}_deleted: skip`, e.message);
  }
}

let mediaFilesDeleted = 0;
let mediaMsgsCleared = 0;
for (let round = 0; round < 20; round++) {
  const { data: oldMsgs } = await sb
    .from("messages")
    .select("id, media")
    .not("media", "is", null)
    .lt("sent_at", mediaCutoff)
    .limit(500);
  if (!oldMsgs?.length) break;

  const paths = [];
  const ids = [];
  for (const row of oldMsgs) {
    let media = row.media;
    if (typeof media === "string") {
      try {
        media = JSON.parse(media);
      } catch {
        media = null;
      }
    }
    if (media && typeof media === "object") {
      const p =
        (typeof media.storagePath === "string" && media.storagePath) ||
        (typeof media.url === "string" ? storagePathFromMediaUrl(media.url) : null);
      if (p) paths.push(p);
    }
    ids.push(row.id);
  }

  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await sb.storage.from("media").remove(chunk);
    if (!error) mediaFilesDeleted += chunk.length;
  }
  for (let i = 0; i < ids.length; i += 200) {
    await sb.from("messages").update({ media: { url: null, expired: true } }).in("id", ids.slice(i, i + 200));
  }
  mediaMsgsCleared += ids.length;
}
console.log("media_files_deleted:", mediaFilesDeleted, "media_messages_cleared:", mediaMsgsCleared);
