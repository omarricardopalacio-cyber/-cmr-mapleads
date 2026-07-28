/**
 * Aplica columnas category + Open Graph en Supabase (service role).
 * node scripts/apply-store-syncro-migration.mjs
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envText = fs.readFileSync(".env", "utf8");
function getEnv(key) {
  const m = envText.match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"));
  return m ? m[1].trim() : "";
}

const url = getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sql = fs.readFileSync(
  "supabase/migrations/20260727200000_store_syncro_social_category.sql",
  "utf8",
);

// PostgREST no ejecuta DDL; usamos el endpoint pg via rpc si existe, si no instruimos.
const sb = createClient(url, key, { auth: { persistSession: false } });

console.log("Intentando aplicar migración vía SQL Editor API no disponible.");
console.log("Ejecuta este SQL en Supabase → SQL Editor:\n");
console.log(sql);

// Verificación suave: intentar select category
const { error: e1 } = await sb.from("products").select("id, category").limit(1);
if (e1) console.log("products.category:", e1.message);
else console.log("products.category: OK (columna existe o es nullable ignorada)");

const { error: e2 } = await sb.from("store_configs").select("social_title, accent_color").limit(1);
if (e2) console.log("store_configs OG:", e2.message);
else console.log("store_configs OG: OK");
