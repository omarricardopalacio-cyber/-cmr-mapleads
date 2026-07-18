import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const urlMatch = env.match(/SUPABASE_URL="(.*)"/);
const keyMatch = env.match(/SUPABASE_PUBLISHABLE_KEY="(.*)"/);

const supabaseUrl = urlMatch ? urlMatch[1] : null;
const supabaseKey = keyMatch ? keyMatch[1] : null;

if (!supabaseUrl || !supabaseKey) {
  console.error("Could not find Supabase URL/Key in .env");
  process.exit(1);
}

console.log("Supabase URL:", supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: configs, error: configErr } = await supabase
    .from('catalog_integrations')
    .select('*');

  if (configErr) {
    console.error("catalog_integrations error:", configErr);
  } else {
    console.log("catalog_integrations:", configs);
  }

  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('*')
    .limit(10);

  if (prodErr) {
    console.error("products error:", prodErr);
  } else {
    console.log("Local products count:", products?.length);
    console.log(products?.map(p => ({ id: p.id, name: p.name, price: p.price, video_url: p.video_url })));
  }
}

check().catch(console.error);
