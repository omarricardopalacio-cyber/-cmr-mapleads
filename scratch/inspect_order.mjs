import fs from 'fs';
import path from 'path';

const envText = fs.readFileSync(path.resolve('.env'), 'utf8');
const vars = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^=#]+)=(.*)$/);
  if (m) vars[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
}

const url = vars.VITE_SUPABASE_URL || vars.SUPABASE_URL;
const key = vars.SUPABASE_SERVICE_ROLE_KEY || vars.SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error('MISSING ENV');
  process.exit(1);
}

const headers = { 
  apikey: key, 
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json'
};

async function run() {
  const res = await fetch(`${url}/rest/v1/products?select=id,name,price,sku&limit=10`, { headers });
  const products = await res.json();
  console.log('--- FIRST 10 PRODUCTS ---');
  console.log(JSON.stringify(products, null, 2));
}

run().catch(console.error);
