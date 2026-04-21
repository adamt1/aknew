import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanup() {
  console.log('Fetching pending reminders...');
  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'pending');

  if (error) {
    console.error('Error fetching reminders:', error);
    return;
  }

  console.log(`Found ${reminders.length} pending reminders.`);

  const seen = new Set();
  const toDelete = [];

  for (const r of reminders) {
    // Create a key for uniqueness: chat_id + text + remind_at
    const key = `${r.chat_id}|${r.reminder_text}|${r.remind_at}`;
    if (seen.has(key)) {
      toDelete.push(r.id);
    } else {
      seen.add(key);
    }
  }

  if (toDelete.length === 0) {
    console.log('No duplicates found.');
    return;
  }

  console.log(`Deleting ${toDelete.length} duplicates...`);
  const { error: deleteError } = await supabase
    .from('reminders')
    .delete()
    .in('id', toDelete);

  if (deleteError) {
    console.error('Error deleting duplicates:', deleteError);
  } else {
    console.log('Cleanup successful.');
  }
}

cleanup();
