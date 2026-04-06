import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function listTables() {
  const { data, error } = await supabase.rpc('get_tables'); // Or some other way to check tables
  if (error) {
     const { data: m, error: e } = await supabase.from('messages').select('*').limit(1);
     if (!e) console.log('Messages table exists');
     
     const { data: r, error: er } = await supabase.from('reminders').select('*').limit(1);
     if (!er) console.log('Reminders table exists');
     
     const { data: w, error: ew } = await supabase.from('processed_webhooks').select('*').limit(1);
     if (!ew) console.log('Processed_webhooks table exists');
     else console.log('Processed_webhooks table does NOT exist');
  }
}

listTables().catch(console.error);
