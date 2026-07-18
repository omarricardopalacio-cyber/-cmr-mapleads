import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in environment");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Checking database...");

  // 1. Check catalog integrations
  const { data: integrations, error: intError } = await supabase
    .from('catalog_integrations')
    .select('*');

  if (intError) {
    console.error("Error fetching catalog_integrations:", intError);
  } else {
    console.log("Catalog Integrations count:", integrations?.length);
    console.log("Active integrations:", integrations?.filter(i => i.is_active));
  }

  // 2. Check local products
  const { data: localProds, error: prodError } = await supabase
    .from('products')
    .select('id, name, org_id, is_active, price, video_url, image_url')
    .limit(10);

  if (prodError) {
    console.error("Error fetching products:", prodError);
  } else {
    console.log("Local products count (sample):", localProds?.length);
    console.log(localProds);
  }

  // 3. Let's check some threads
  const { data: threads, error: threadError } = await supabase
    .from('threads')
    .select('id, org_id, focused_product_id, focused_product_snapshot')
    .limit(5);

  if (threadError) {
    console.error("Error fetching threads:", threadError);
  } else {
    console.log("Threads sample:", threads);
  }
}

run().catch(console.error);
