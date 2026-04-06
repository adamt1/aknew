import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkMessages() {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error('Error fetching messages:', error);
    return;
  }
  
  console.log('Last 10 messages:');
  data.forEach(m => {
    console.log(`[${m.created_at}] ${m.role}: ${m.content.substring(0, 50)}...`);
  });
}

checkMessages().catch(console.error);
