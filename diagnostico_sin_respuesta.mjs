import fs from 'fs';
import path from 'path';

const envText = fs.readFileSync(path.resolve('.env'), 'utf8');
const vars = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^=#]+)=(.*)$/);
  if (m) vars[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
}
const url = vars.SUPABASE_URL;
const key = vars.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function api(p, params = {}) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const fullUrl = `${url}/rest/v1/${p}${qs ? '?' + qs : ''}`;
  const res = await fetch(fullUrl, { headers: { ...headers, Accept: 'application/json' } });
  if (!res.ok) { const txt = await res.text(); throw new Error(`${res.status}: ${txt.slice(0, 200)}`); }
  return res.json();
}

const msgs = await api('messages', {
  select: 'id,thread_id,text,direction,created_at',
  direction: 'eq.in',
  order: 'created_at.desc',
  limit: '50',
});

const threads = {};
for (const m of msgs) {
  if (!threads[m.thread_id]) threads[m.thread_id] = { ins: [], outs: [] };
  threads[m.thread_id].ins.push(m);
}

for (const tid of Object.keys(threads)) {
  const outs = await api('messages', {
    select: 'id,text,created_at',
    thread_id: `eq.${tid}`,
    direction: 'eq.out',
    order: 'created_at.desc',
    limit: '5',
  });
  threads[tid].outs = outs;
}

console.log('=== THREADS CON IN > OUT en los ultimos 50 mensajes ===');
for (const [tid, data] of Object.entries(threads)) {
  const lastIn = data.ins[0]?.created_at || '?';
  const outCount = data.outs.length;
  const inCount = data.ins.length;
  const lastInDate = new Date(data.ins[0]?.created_at).getTime();
  const hasRecentOut = data.outs.some(o => new Date(o.created_at).getTime() > lastInDate - 5000);
  const marker = hasRecentOut ? 'OK' : '*** SIN RESPUESTA ***';
  const preview = (data.ins[0]?.text || '').slice(0, 60);
  console.log(`  ${marker} thread=${tid} in=${inCount} out=${outCount} lastIn=${lastIn} msg="${preview}"`);
}
