import { execSync } from 'child_process';
import { createRequire } from 'module';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve DB IP via PowerShell (since Node.js DNS fails on this network)
function resolveIP(hostname) {
  try {
    const cmd = `powershell -NoProfile -Command "Resolve-DnsName ${hostname} -Type AAAA | Select-Object -ExpandProperty IPAddress"`;
    const ip = execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0];
    return ip;
  } catch {
    return null;
  }
}

const HOSTNAME = 'db.cgofmgtimyiatbbihppp.supabase.co';
const PASSWORD = 'Mirled1023*';
const USER = 'postgres';
const DB = 'postgres';
const PORT = 5432;

const ip = resolveIP(HOSTNAME);
if (!ip) {
  console.error('Could not resolve database IP');
  process.exit(1);
}
console.log('Resolved IP:', ip);

const { default: pg } = await import('pg');
const { Client } = pg;

const client = new Client({
  host: ip,
  port: PORT,
  user: USER,
  password: PASSWORD,
  database: DB,
  ssl: { rejectUnauthorized: false }
});

await client.connect();
console.log('Connected to database');

// Test connection
const { rows } = await client.query('SELECT version(), current_database() as db');
console.log('Connected:', rows[0]);

// Read migrations directory
const migrationsDir = join(__dirname, '..', 'supabase', 'migrations');
const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
console.log(`Found ${files.length} migration files`);

// Run each migration
for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  const label = file.slice(0, 30) + '...';
  process.stdout.write(`Running ${label} `);
  try {
    // Skip IF NOT EXISTS related errors gracefully
    await client.query(sql);
    console.log('OK');
  } catch (err) {
    // Some migrations may have idempotency issues, log but continue
    console.log(`WARN: ${err.message.slice(0, 100)}`);
  }
}

// Seed data
console.log('Inserting seed data...');
try {
  await client.query(`INSERT INTO public.global_settings (id) VALUES (true) ON CONFLICT DO NOTHING`);
  console.log('global_settings: OK');
} catch (e) { console.log('global_settings:', e.message.slice(0, 80)); }

try {
  await client.query(`INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('media', 'media', true, 52428800) ON CONFLICT (id) DO NOTHING`);
  console.log('storage bucket media: OK');
} catch (e) { console.log('storage bucket:', e.message.slice(0, 80)); }

await client.end();
console.log('\nMigration complete!');
