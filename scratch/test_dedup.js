import fs from 'fs';
import path from 'path';

// Read .env from the project directory
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

async function testLoadThreadHistory(threadId, userText) {
  // Query only the database (which doesn't contain the "new" message yet)
  // Let's filter out the message with id '30f0fef6-7e5d-4a90-8203-b58ac903a64e' (which is the most recent one we sent at 23:31:27)
  // to simulate the database query not returning the new message.
  const prior = await api('messages', {
    select: 'id,direction,text,sent_at',
    thread_id: `eq.${threadId}`,
    id: `neq.30f0fef6-7e5d-4a90-8203-b58ac903a64e`,
    text: 'not.is.null',
    order: 'sent_at.desc',
    limit: '16'
  });

  console.log(`=== DATABASE QUERY RESULT (excluding newest msg) ===`);
  console.log(JSON.stringify(prior, null, 2));

  const MAX_MSG_CHARS = 1200;
  
  const priorMsgs = prior
    .filter((m) => typeof m.text === 'string' && m.text.trim().length > 0)
    .reverse()
    .map((m) => ({
      role: m.direction === 'out' ? 'assistant' : 'user',
      content: String(m.text).trim().slice(0, MAX_MSG_CHARS),
    }));

  // Old matches logic (without recency check)
  const oldLastPrior = priorMsgs[priorMsgs.length - 1];
  const oldLastPriorMatches = oldLastPrior && oldLastPrior.role === 'user' && oldLastPrior.content === userText.trim();
  const oldResult = oldLastPriorMatches
    ? priorMsgs
    : [...priorMsgs, { role: 'user', content: userText }];

  // New matches logic (with recency check)
  const lastPriorRaw = prior.filter((m) => typeof m.text === 'string' && m.text.trim().length > 0)[0];
  const lastPriorSentAt = lastPriorRaw ? new Date(lastPriorRaw.sent_at).getTime() : 0;
  const isRecent = Math.abs(Date.now() - lastPriorSentAt) < 60000;
  const newLastPrior = priorMsgs[priorMsgs.length - 1];
  const newLastPriorMatches = newLastPrior && 
    newLastPrior.role === 'user' && 
    newLastPrior.content === userText.trim() && 
    isRecent;
  
  const newResult = newLastPriorMatches
    ? priorMsgs
    : [...priorMsgs, { role: 'user', content: userText }];

  console.log('\n=== DEDUPLICATION COMPARISON ===');
  console.log(`User Text: "${userText}"`);
  console.log(`Old logic matched: ${oldLastPriorMatches}`);
  console.log(`Old logic history length: ${oldResult.length} (last: "${oldResult[oldResult.length - 1]?.content}")`);
  console.log(`New logic matched: ${newLastPriorMatches}`);
  console.log(`New logic history length: ${newResult.length} (last: "${newResult[newResult.length - 1]?.content}")`);
}

async function main() {
  const threadId = "9e71d7cf-fdc3-4314-a410-48dfc09f21a4";
  const userText = "hola prueba contexto";
  await testLoadThreadHistory(threadId, userText);
}

main().catch(console.error);
