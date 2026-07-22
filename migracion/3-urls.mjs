// ============================================================
//  Reescritura de URLs de media en la BASE DE DATOS del destino
//  Cambia el host del proyecto viejo por el nuevo y convierte
//  URLs firmadas (/object/sign/) en publicas (/object/public/).
//  Ejecutar DESPUES de 1-db y 2-storage:  node migracion/3-urls.mjs
// ============================================================
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", "..", "migracion.env");

const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
for (const k of ["SRC_SUPABASE_URL", "DST_SUPABASE_URL", "DST_DB_URL"]) {
  if (!env[k]) throw new Error(`Falta ${k} en migracion.env`);
}

const srcHost = new URL(env.SRC_SUPABASE_URL).host; // p.ej. cgofmgtimyiatbbihppp.supabase.co
const dstHost = new URL(env.DST_SUPABASE_URL).host;
console.log(`Reemplazando host:  ${srcHost}  ->  ${dstHost}`);

const client = new pg.Client({ connectionString: env.DST_DB_URL });

// Columnas de tipo TEXT que pueden contener URLs del bucket
const TEXT_COLS = [
  ["auto_replies", "media_url"],
  ["auto_reply_steps", "media_url"],
  ["broadcasts", "media_url"],
  ["quick_replies", "media_url"],
  ["products", "image_url"],
  ["products", "video_url"],
  ["profiles", "avatar_url"],
];

async function run(sql, params) {
  try {
    const r = await client.query(sql, params);
    return r.rowCount ?? 0;
  } catch (e) {
    // Si una tabla/columna no existe en este proyecto, lo avisamos y seguimos.
    console.warn(`  (aviso) ${e.message}`);
    return 0;
  }
}

async function main() {
  await client.connect();

  // 1) messages.media (JSONB) -> operar sobre su texto
  let n = await run(
    `UPDATE public.messages
       SET media = replace(media::text, $1, $2)::jsonb
     WHERE media::text LIKE '%' || $1 || '%'`,
    [srcHost, dstHost]
  );
  console.log(`messages.media (host):            ${n}`);

  n = await run(
    `UPDATE public.messages
       SET media = regexp_replace(media::text, '/object/sign/media/', '/object/public/media/', 'g')::jsonb
     WHERE media::text LIKE '%/object/sign/media/%'`
  );
  console.log(`messages.media (sign->public):    ${n}`);

  n = await run(
    `UPDATE public.messages
       SET media = regexp_replace(media::text, '\\?token=[^"\\\\]*', '', 'g')::jsonb
     WHERE media::text LIKE '%token=%'`
  );
  console.log(`messages.media (quita token):     ${n}`);

  // 2) Columnas TEXT
  for (const [tbl, col] of TEXT_COLS) {
    let c = await run(
      `UPDATE public.${tbl} SET ${col} = replace(${col}, $1, $2)
        WHERE ${col} LIKE '%' || $1 || '%'`,
      [srcHost, dstHost]
    );
    await run(
      `UPDATE public.${tbl} SET ${col} = regexp_replace(${col}, '/object/sign/media/', '/object/public/media/', 'g')
        WHERE ${col} LIKE '%/object/sign/media/%'`
    );
    await run(
      `UPDATE public.${tbl} SET ${col} = regexp_replace(${col}, '\\?token=.*$', '')
        WHERE ${col} LIKE '%token=%'`
    );
    console.log(`${tbl}.${col} (host):`.padEnd(34) + ` ${c}`);
  }

  await client.end();
  console.log("\nLISTO: URLs reescritas al nuevo proyecto.");
}

main().catch(async (e) => {
  console.error(e);
  try { await client.end(); } catch {}
  process.exit(1);
});
