import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Read .env manually
const envText = fs.readFileSync('c:/Users/USUARIO/Desktop/hennry/plan-maestro-bridge-e50a0f47/.env', 'utf8');
const vars = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^=#]+)=(.*)$/);
  if (m) vars[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
}

const supabaseUrl = vars.SUPABASE_URL || vars.VITE_SUPABASE_URL;
const supabaseKey = vars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing credentials in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Querying products...");
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, external_id, image_url, video_url, price, stock')
    .limit(10);

  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log(`Found ${products.length} products:`);
  products.forEach((p, idx) => {
    console.log(`\nProduct #${idx + 1}: ${p.name}`);
    console.log(`- ID: ${p.id}`);
    console.log(`- External ID: ${p.external_id}`);
    console.log(`- Price: ${p.price}`);
    console.log(`- Stock: ${p.stock}`);
    console.log(`- Image URL: ${p.image_url}`);
    console.log(`- Video URL: ${p.video_url}`);
    console.log(`- Raw exists: ${p.raw != null}`);
    if (p.raw) {
      console.log(`- Raw snippet: ${JSON.stringify(p.raw).slice(0, 300)}...`);
    }
  });
}

run().catch(console.error);
