import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envText = fs.readFileSync(".env", "utf8");
function getEnv(key) {
  const m = envText.match(new RegExp(`^${key}="?([^"\n]+)"?`, "m"));
  return m ? m[1].trim() : "";
}

const url = getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function scan(prefix = "") {
  const sizes = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb.storage.from("media").list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) throw error;
    if (!data?.length) break;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        sizes.push(...(await scan(path)));
      } else {
        sizes.push(item.metadata?.size || 0);
      }
    }
    if (data.length < 1000) break;
    offset += 1000;
    if (offset > 100000) {
      console.warn("Stopped scan at 100k listing offset");
      break;
    }
  }
  return sizes;
}

const { data: buckets } = await sb.storage.listBuckets();
const { count: messages } = await sb.from("messages").select("id", { count: "exact", head: true });
const { count: msgMedia } = await sb
  .from("messages")
  .select("id", { count: "exact", head: true })
  .not("media", "is", null);
const { count: events } = await sb.from("events").select("id", { count: "exact", head: true });

console.log(JSON.stringify({ supabase_url: url, buckets: buckets?.map((b) => b.id) }, null, 2));
console.log("DB counts:", { messages, messages_with_media: msgMedia, events_rows: events });

const sizes = await scan("");
const total = sizes.reduce((s, n) => s + n, 0);
const gb = total / 1024 / 1024 / 1024;
console.log("Storage media bucket:");
console.log("  files:", sizes.length);
console.log("  total_mb:", (total / 1024 / 1024).toFixed(1));
console.log("  total_gb:", gb.toFixed(2));
console.log("  free_plan_limit_gb: 1");
console.log("  OVER_QUOTA:", gb > 1);
