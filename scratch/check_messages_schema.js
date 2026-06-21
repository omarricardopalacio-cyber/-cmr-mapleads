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

async function main() {
  // Query Supabase API for messages table schema information
  const res = await fetch(`${url}/rest/v1/`, {
    method: "GET",
    headers: { ...headers }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch schema: ${res.statusText}`);
  }
  const schema = await res.json();
  const messagesTable = schema.definitions?.messages;
  console.log('=== MESSAGES TABLE DEFINITION ===');
  console.log(JSON.stringify(messagesTable, null, 2));
}

main().catch(console.error);
