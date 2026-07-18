import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env', 'utf8');
const urlMatch = env.match(/VITE_SUPABASE_URL=(.*)/);
const keyMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);

const supabase = createClient(urlMatch[1], keyMatch[1]);
supabase.from('broadcast_recipients').select('*').eq('status', 'failed').order('created_at', { ascending: false }).limit(5).then(res => console.log(JSON.stringify(res.data, null, 2))).catch(console.error);
