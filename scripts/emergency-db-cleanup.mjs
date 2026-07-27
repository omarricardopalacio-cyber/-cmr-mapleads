/**
 * Limpieza de emergencia: baja el tamaño de la BD (limite Free = 500 MB).
 * Uso: node scripts/emergency-db-cleanup.mjs
 * Env: AUDIT_RETENTION_DAYS (def. 3), MAX_EVENT_ROUNDS (def. 200)
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
const auditDays = Number(process.env.AUDIT_RETENTION_DAYS ?? "1");
const maxRounds = Number(process.env.MAX_EVENT_ROUNDS ?? "500");
const targetEvents = Number(process.env.TARGET_EVENTS ?? "20000");
const selectBatch = 1000;
const deleteBatch = 500;

const sb = createClient(url, key, { auth: { persistSession: false } });
const auditCutoff = new Date(Date.now() - auditDays * 86400000).toISOString();

async function count(table) {
  const { count, error } = await sb.from(table).select("id", { count: "exact", head: true });
  if (error) return `err:${error.message}`;
  return count ?? 0;
}

console.log("=== EMERGENCY DB CLEANUP ===");
console.log({ auditDays, auditCutoff, maxRounds, targetEvents, selectBatch, deleteBatch });
console.log("Antes:", {
  events: await count("events"),
  messages: await count("messages"),
  engine_commands: await count("engine_commands"),
  ai_actions_log: await count("ai_actions_log"),
});

let eventsDeleted = 0;
for (let i = 0; i < maxRounds; i++) {
  const remaining = await count("events");
  if (typeof remaining === "number" && remaining <= targetEvents) {
    console.log(`  target reached: ${remaining} events`);
    break;
  }

  const { data, error } = await sb
    .from("events")
    .select("id")
    .lt("created_at", auditCutoff)
    .order("created_at", { ascending: true })
    .limit(selectBatch);

  let ids = (data ?? []).map((r) => r.id);

  // Si casi todo es reciente, borrar los mas viejos hasta llegar al target
  if (!ids.length && typeof remaining === "number" && remaining > targetEvents) {
    const excess = remaining - targetEvents;
    const take = Math.min(excess, selectBatch);
    const { data: oldest } = await sb
      .from("events")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(take);
    ids = (oldest ?? []).map((r) => r.id);
  }

  if (error) {
    console.error("events select error:", error.message);
    break;
  }
  if (!ids.length) break;

  for (let j = 0; j < ids.length; j += deleteBatch) {
    const chunk = ids.slice(j, j + deleteBatch);
    const { count: n, error: delErr } = await sb.from("events").delete({ count: "exact" }).in("id", chunk);
    if (delErr) {
      console.error("events delete error:", delErr.message);
      break;
    }
    eventsDeleted += n ?? chunk.length;
  }
  if ((i + 1) % 10 === 0 || ids.length < selectBatch) {
    console.log(`  events round ${i + 1}: total_deleted=${eventsDeleted}, remaining~=${await count("events")}`);
  }
}
console.log("events_deleted:", eventsDeleted);

for (const table of ["engine_commands", "ai_actions_log"]) {
  try {
    const q =
      table === "engine_commands"
        ? sb
            .from(table)
            .delete({ count: "exact" })
            .in("status", ["acked", "failed", "delivered"])
            .lt("created_at", auditCutoff)
        : sb.from(table).delete({ count: "exact" }).lt("created_at", auditCutoff);
    const { count: n } = await q;
    console.log(`${table}_deleted:`, n ?? 0);
  } catch (e) {
    console.log(`${table}_deleted: skip`, e.message);
  }
}

// Quitar JSON pesado de media en mensajes viejos (libera espacio en BD, archivos siguen en Storage)
let mediaStripped = 0;
for (let round = 0; round < 50; round++) {
  const { data: rows } = await sb
    .from("messages")
    .select("id")
    .not("media", "is", null)
    .lt("sent_at", auditCutoff)
    .limit(500);
  if (!rows?.length) break;
  const ids = rows.map((r) => r.id);
  await sb.from("messages").update({ media: { expired: true } }).in("id", ids);
  mediaStripped += ids.length;
}
console.log("messages_media_stripped:", mediaStripped);

console.log("Despues:", {
  events: await count("events"),
  messages: await count("messages"),
});
console.log("Listo. En Supabase Dashboard espera 1-5 min y recarga el uso de BD.");
