import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkHistory() {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('thread_id', '972523948711@c.us')
    .order('created_at', { ascending: true });
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Chana history:');
  data.forEach(m => {
    console.log(`[${m.created_at}] ${m.role}: ${m.content}`);
  });
}

checkHistory().catch(console.error);
