
import fs from 'fs';
import { createClient } from './node_modules/@supabase/supabase-js/dist/main/index.js';

const env = fs.readFileSync('.env', 'utf8');
const urlMatch = env.match(/VITE_SUPABASE_URL=(.*)/);
const keyMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);

const supabase = createClient(urlMatch[1], keyMatch[1]);
supabase.storage.listBuckets().then(res => console.log(JSON.stringify(res.data, null, 2))).catch(console.error);

