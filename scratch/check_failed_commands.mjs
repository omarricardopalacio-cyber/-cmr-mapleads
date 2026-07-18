import fs from 'fs';
import path from 'path';

const envText = fs.readFileSync(path.resolve('.env'), 'utf8');
const vars = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^=#]+)=(.*)$/);
  if (m) vars[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
}

const url = vars.SUPABASE_URL;
const serviceKey = vars.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json'
};

async function query(endpoint) {
  const fullUrl = `${url}/rest/v1/${endpoint}`;
  try {
    const res = await fetch(fullUrl, { headers });
    if (!res.ok) {
      return { error: `HTTP ${res.status} ${res.statusText}`, body: await res.text() };
    }
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

async function run() {
  console.log('=== FAILED ENGINE COMMAND DETAILS ===');
  const commands = await query('engine_commands?select=id,type,payload,status,ack,created_at&status=eq.failed&order=created_at.desc&limit=5');
  console.log(JSON.stringify(commands, null, 2));
}

run();
