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
    .order('created_at', { ascending: false })
    .limit(30);
    
  if (error) {
    console.error('Error fetching history:', error);
    return;
  }
  
  console.log('Last 30 messages in conversation_history:');
  data.reverse().forEach(m => {
    console.log(`[${m.created_at}] [Chat: ${m.thread_id}] ${m.role}: ${m.content}`);
  });
}

checkHistory().catch(console.error);
