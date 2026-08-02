import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const migrationsDir = join(__dirname, "supabase", "migrations");
const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}...`);
    await client.query(sql);
    console.log(`OK ${file}`);
  }
  const { rows } = await client.query(`
    select tablename, rowsecurity
    from pg_tables
    where schemaname = 'public'
      and tablename in (
        'profiles', 'organizations', 'user_roles', 'store_configs', 'products_public',
        'desktop_devices', 'sync_inbound_events', 'sync_outbound_events',
        'web_sessions', 'web_messages_public'
      )
    order by tablename;
  `);
  console.log("Tables:", rows);
} finally {
  await client.end();
}
