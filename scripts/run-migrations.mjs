#!/usr/bin/env node
/**
 * run-migrations.mjs
 * Ejecuta migraciones Fase 1 y Fase 2 via Supabase Management API
 * Requiere: SUPABASE_ACCESS_TOKEN en .env
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadEnv() {
  try {
    const content = readFileSync(join(ROOT, '.env'), 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return env;
  } catch { return {}; }
}

const env = { ...loadEnv(), ...process.env };
const PROJECT_ID = env.SUPABASE_PROJECT_ID || env.VITE_SUPABASE_PROJECT_ID;
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;

const MIGRATIONS = [
  { name: 'Fase 1 — Fundacion Multi-Tenant', file: join(ROOT, 'docs/migrations/20260614000000_saas_multitenant_phase1.sql') },
  { name: 'Fase 2 — Plantilla Global Sincronizada', file: join(ROOT, 'docs/migrations/20260614010000_saas_multitenant_phase2.sql') },
];

async function executeSql(sql) {
  if (ACCESS_TOKEN) {
    const url = https://api.supabase.com/v1/projects//database/query;
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','Authorization':Bearer }, body: JSON.stringify({ query: sql }) });
    const text = await res.text();
    if (!res.ok) throw new Error(Management API : );
    return JSON.parse(text);
  } else if (SERVICE_ROLE) {
    const url = https://.supabase.co/rest/v1/rpc/exec_sql;
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','apikey':SERVICE_ROLE,'Authorization':Bearer }, body: JSON.stringify({ sql }) });
    const text = await res.text();
    if (!res.ok) throw new Error(Service Role : );
    return JSON.parse(text);
  } else {
    throw new Error('Necesitas SUPABASE_ACCESS_TOKEN o SUPABASE_SERVICE_ROLE_KEY en .env');
  }
}

async function main() {
  console.log('EJECUTOR DE MIGRACIONES SaaS Multi-Tenant');
  console.log('Proyecto:', PROJECT_ID);
  if (!PROJECT_ID) { console.error('SUPABASE_PROJECT_ID no definido'); process.exit(1); }
  if (!ACCESS_TOKEN && !SERVICE_ROLE) {
    console.error('\nCredenciales faltantes. Agrega al .env:');
    console.error('  SUPABASE_ACCESS_TOKEN=sbp_xxxx  (desde supabase.com/dashboard/account/tokens)');
    console.error('  -- O --');
    console.error(  SUPABASE_SERVICE_ROLE_KEY=eyJ... (desde supabase.com/dashboard/project//settings/api));
    process.exit(1);
  }
  for (const m of MIGRATIONS) {
    console.log('\n======', m.name);
    const sql = readFileSync(m.file, 'utf8');
    console.log('Bytes:', sql.length, '| Lineas:', sql.split('\n').length);
    try {
      await executeSql(sql);
      console.log('OK migración completada');
    } catch(e) {
      console.error('ERROR:', e.message);
      process.exit(1);
    }
  }
  console.log('\nTodas las migraciones completadas.');
  console.log('Validaciones SQL:');
  console.log("  SELECT * FROM global.config_version;");
  console.log("  SELECT table_name FROM information_schema.views WHERE table_schema='public' AND table_name LIKE '%_v';");
  console.log("  SELECT * FROM public.ai_configs_v LIMIT 1;");
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });
