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

async function api(path, params = {}) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const fullUrl = `${url}/rest/v1/${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(fullUrl, {
    headers: { ...headers, Accept: 'application/json' },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

async function main(threadId) {
  if (!threadId) {
    const recent = await api('messages', {
      select: 'id,thread_id,text,direction,created_at',
      order: 'created_at.desc',
      limit: '10',
    });
    console.log('=== ÚLTIMOS 10 MENSAJES ===');
    for (const m of recent) {
      const preview = (m.text ?? '').slice(0, 60);
      console.log(`  [${m.direction}] thread=${m.thread_id} "${preview}" (${m.created_at})`);
    }
    console.log('\nUsa: node diagnostico_flujo.mjs <THREAD_ID>');
    return;
  }

  console.log(`\n=== DIAGNÓSTICO PARA THREAD: ${threadId} ===`);

  // 1. Mensajes del thread
  const msgs = await api('messages', {
    select: 'id,text,direction,created_at',
    thread_id: `eq.${threadId}`,
    order: 'created_at.asc',
  });
  console.log(`\n[1] messages: ${msgs.length} mensajes`);
  for (const m of msgs) {
    const preview = (m.text ?? '').slice(0, 80);
    console.log(`    [${m.direction}] "${preview}" (${m.created_at})`);
  }

  // 2. Engine commands
  const sessionResult = await api('sessions', {
    select: 'id',
    thread_id: `eq.${threadId}`,
    limit: '1',
  });
  const sessionId = sessionResult[0]?.id;
  if (sessionId) {
    const cmds = await api('engine_commands', {
      select: 'id,type,status,created_at,payload',
      session_id: `eq.${sessionId}`,
      order: 'created_at.desc',
    });
    console.log(`\n[2] engine_commands para session ${sessionId}: ${cmds.length} comandos`);
    for (const c of cmds) {
      const text = c.payload?.text ?? '(no text)';
      console.log(`    ${c.type} | ${c.status} | "${String(text).slice(0, 60)}" (${c.created_at})`);
    }
  } else {
    console.log(`\n[2] No se encontró session para thread ${threadId}`);
  }

  // 3. Failed AI requests
  const failed = await api('failed_ai_requests', {
    select: 'id,thread_id,status,error_message,created_at',
    thread_id: `eq.${threadId}`,
    order: 'created_at.desc',
  });
  console.log(`\n[3] failed_ai_requests: ${failed.length} registros`);
  for (const f of failed) {
    console.log(`    id=${f.id} | status=${f.status} | error="${(f.error_message ?? '').slice(0, 150)}" (${f.created_at})`);
  }

  // 4. Thread info
  const thread = await api('threads', {
    select: 'id,ai_enabled,purchase_intent,org_id',
    id: `eq.${threadId}`,
    limit: '1',
  });
  if (thread[0]) {
    console.log(`\n[4] thread: ai_enabled=${thread[0].ai_enabled}, purchase_intent=${thread[0].purchase_intent}, org_id=${thread[0].org_id}`);

    // 5. AI Config
    const cfg = await api('ai_configs', {
      select: '*',
      org_id: `eq.${thread[0].org_id}`,
      limit: '1',
    });
    if (cfg[0]) {
      console.log(`\n[5] ai_config: enabled=${cfg[0].enabled}, respond_to=${cfg[0].respond_to}, provider=${cfg[0].selected_provider || cfg[0].provider}, model=${cfg[0].model}`);
    }

    // 6. Auto-replies
    const autoReplies = await api('auto_replies', {
      select: 'id,name,trigger_type,is_active',
      org_id: `eq.${thread[0].org_id}`,
      is_active: 'eq.true',
    });
    console.log(`\n[6] auto_replies activas: ${autoReplies.length}`);
    for (const ar of autoReplies) {
      console.log(`    ${ar.name} (trigger: ${ar.trigger_type})`);
    }
  } else {
    console.log(`\n[4] Thread no encontrado`);
  }

  // 7. Últimos mensajes OUT para ver si hubo respuesta
  const outMsgs = msgs.filter(m => m.direction === 'out');
  console.log(`\n[7] mensajes OUT (posibles respuestas): ${outMsgs.length}`);
  if (outMsgs.length === 0) {
    console.log('    *** NO HAY RESPUESTA — el flujo no llegó a generar engine_commands ***');
  }
}

main(process.argv[2]).catch(e => {
  console.error('ERROR:', e.message ?? e);
  process.exit(1);
});
