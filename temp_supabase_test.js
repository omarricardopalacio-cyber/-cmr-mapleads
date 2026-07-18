const fs = require('fs');
const path = require('path');
const envText = fs.readFileSync(path.resolve('.env'), 'utf8');
const vars = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^=#]+)=(.*)$/);
  if (m) vars[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
}
const url = vars.SUPABASE_URL;
const key = vars.SUPABASE_PUBLISHABLE_KEY;
console.log('URL', !!url, 'KEY', !!key);
if (!url || !key) {
  console.error('MISSING ENV');
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const paths = [
  'catalog_integrations?select=*',
  'products?select=id,name,org_id,is_active&limit=5',
  'master_products?select=id,name&limit=5',
  'products?select=id,name&limit=1',
  'master_products?select=id,name&limit=1',
];
(async () => {
  for (const p of paths) {
    const urlFull = `${url}/rest/v1/${p}`;
    console.log('PATH', p);
    try {
      const res = await fetch(urlFull, { headers });
      console.log('STATUS', res.status, res.statusText);
      const text = await res.text();
      console.log('BODY', text.slice(0, 1200));
    } catch (e) {
      console.error('ERROR', e.message || e);
    }
  }
})();
