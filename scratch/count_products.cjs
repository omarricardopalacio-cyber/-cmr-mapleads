const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const env = fs.readFileSync('c:/Users/USUARIO/Desktop/hennry/plan-maestro-bridge-e50a0f47/.env', 'utf8');
const vars = {};
env.split(/\r?\n/).forEach(l => {
  const m = l.match(/^([^=#]+)=(.*)$/);
  if (m) vars[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
});

const supabase = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY);
supabase.from('products').select('*', { count: 'exact', head: true }).then(r => {
  console.log('Total products count:', r.count);
  if (r.error) console.error(r.error);
});
