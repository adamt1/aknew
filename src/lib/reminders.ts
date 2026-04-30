import { supabase } from './supabase';
import { greenApi } from './green-api';

export async function processDueReminders() {
  const now = new Date().toISOString();

  // 1. Fetch pending reminders that are due
  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'pending')
    .lte('remind_at', now);

  if (error) {
    console.error(`[REMINDERS_LIB] Error fetching: ${error.message}`);
    return { error: error.message };
  }

  if (!reminders || reminders.length === 0) {
    return { status: 'no_reminders_due' };
  }

  console.log(`[REMINDERS_LIB] Processing ${reminders.length} due reminders...`);
  const results = [];

  for (const reminder of reminders) {
    try {
      // 2. Atomic update: Mark as 'sent' only if it's still 'pending'
      // This prevents multiple concurrent processes from sending the same reminder.
      const { data, error: updateError } = await supabase
        .from('reminders')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', reminder.id)
        .eq('status', 'pending')
        .select();

      if (updateError) {
        console.error(`[REMINDERS_LIB] Failed to claim reminder ${reminder.id}:`, updateError.message);
        continue;
      }

      // If no rows were updated, it means another process already claimed/sent it
      if (!data || data.length === 0) {
        console.log(`[REMINDERS_LIB] Reminder ${reminder.id} already processed by another instance.`);
        continue;
      }

      // 3. Send the reminder via WhatsApp
      const message = `🔔 **תזכורת:**\n\n${reminder.reminder_text}`;
      await greenApi.sendMessage(reminder.chat_id, message);

      results.push({ id: reminder.id, status: 'sent' });
    } catch (e: any) {
      console.error(`[REMINDERS_LIB] Error processing reminder ${reminder.id}:`, e.message);
      
      // Attempt to mark as failed so it doesn't get stuck in 'sent' if it actually failed to send
      // (Though we already marked it as 'sent' to prevent duplicates). 
      // Maybe 'failed' is better for visibility.
      await supabase
        .from('reminders')
        .update({ status: 'failed' })
        .eq('id', reminder.id);

      results.push({ id: reminder.id, status: 'failed', error: e.message });
    }
  }

  return { status: 'processed', count: reminders.length, results };
}
