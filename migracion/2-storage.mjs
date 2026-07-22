// ============================================================
//  Migracion de STORAGE  (bucket "media": ~3 GB / miles de archivos)
//  Copia todos los objetos del origen al destino. Es RE-EJECUTABLE:
//  si un archivo ya existe en destino, lo omite.
//  Ejecutar:  node migracion/2-storage.mjs
// ============================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", "..", "migracion.env"); // C:\...\cmr\migracion.env

const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
for (const k of ["SRC_SUPABASE_URL", "SRC_SERVICE_ROLE_KEY", "DST_SUPABASE_URL", "DST_SERVICE_ROLE_KEY"]) {
  if (!env[k]) throw new Error(`Falta ${k} en migracion.env`);
}

const BUCKET = "media";
const opts = { auth: { persistSession: false } };
const src = createClient(env.SRC_SUPABASE_URL, env.SRC_SERVICE_ROLE_KEY, opts);
const dst = createClient(env.DST_SUPABASE_URL, env.DST_SERVICE_ROLE_KEY, opts);

async function ensureBucket() {
  const { data } = await dst.storage.getBucket(BUCKET);
  if (data) {
    console.log(`Bucket "${BUCKET}" ya existe en destino.`);
    return;
  }
  const { error } = await dst.storage.createBucket(BUCKET, {
    public: true,
  });
  if (error) throw error;
  console.log(`Bucket "${BUCKET}" creado en destino (public).`);
}

// Lista recursiva de todas las rutas de archivo del bucket.
async function listAll(client, prefix = "") {
  const out = [];
  const limit = 100;
  let offset = 0;
  while (true) {
    const { data, error } = await client.storage
      .from(BUCKET)
      .list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        out.push(...(await listAll(client, path))); // carpeta
      } else {
        out.push(path);
      }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

async function existsInDst(path) {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const { data } = await dst.storage.from(BUCKET).list(folder, { limit: 100, search: name });
  return !!data?.some((f) => f.name === name);
}

async function main() {
  await ensureBucket();
  console.log("Listando archivos en el origen (puede tardar)...");
  const files = await listAll(src);
  console.log(`Total de archivos en origen: ${files.length}`);

  let copied = 0, skipped = 0, failed = 0, i = 0;
  for (const path of files) {
    i++;
    try {
      if (await existsInDst(path)) {
        skipped++;
        if (i % 200 === 0) console.log(`  [${i}/${files.length}] ...`);
        continue;
      }
      const { data: blob, error: dErr } = await src.storage.from(BUCKET).download(path);
      if (dErr) throw dErr;
      const buf = Buffer.from(await blob.arrayBuffer());
      const { error: uErr } = await dst.storage.from(BUCKET).upload(path, buf, {
        contentType: blob.type || "application/octet-stream",
        upsert: true,
      });
      if (uErr) throw uErr;
      copied++;
      if (i % 50 === 0) console.log(`  [${i}/${files.length}] copiados=${copied} omitidos=${skipped}`);
    } catch (e) {
      failed++;
      console.error(`  FALLO ${path}: ${e.message || e}`);
    }
  }

  console.log("\n====================================");
  console.log(`HECHO. copiados=${copied}  ya_existian=${skipped}  fallidos=${failed}  total=${files.length}`);
  console.log("====================================");
  if (failed > 0) {
    console.log("Hubo fallos: vuelve a ejecutar el script (omitira los ya copiados).");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
