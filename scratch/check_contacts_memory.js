import fs from 'fs';
import path from 'path';

const envText = fs.readFileSync('c:/Users/USUARIO/Desktop/hennry/plan-maestro-bridge-e50a0f47/.env', 'utf8');
const vars = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^=#]+)=(.*)$/);
  if (m) vars[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
}

const url = vars.SUPABASE_URL;
const key = vars.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function api(table, params = {}) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const fullUrl = `${url}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  const res = await fetch(fullUrl, {
    headers: { ...headers, Accept: 'application/json' },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  const contacts = await api('contacts', {
    select: 'id,display_name,phone,ai_memory',
    limit: '20',
  });
  console.log('=== CONTACTS AI MEMORY ===');
  for (const c of contacts) {
    if (c.ai_memory && Object.keys(c.ai_memory).length > 0) {
      console.log(`Contact: ${c.display_name} (${c.phone})`);
      console.log(JSON.stringify(c.ai_memory, null, 2));
      console.log('------------------------');
    }
  }
}

main().catch(console.error);
