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
      // 2. Send the reminder via WhatsApp
      const message = `🔔 **תזכורת:**\n\n${reminder.reminder_text}`;
      await greenApi.sendMessage(reminder.chat_id, message);

      // 3. Mark as sent
      await supabase
        .from('reminders')
        .update({ status: 'sent' })
        .eq('id', reminder.id);

      results.push({ id: reminder.id, status: 'sent' });
    } catch (e: any) {
      console.error(`[REMINDERS_LIB] Failed to send reminder ${reminder.id}:`, e.message);
      
      // 4. Mark as failed if transmission fails
      await supabase
        .from('reminders')
        .update({ status: 'failed' })
        .eq('id', reminder.id);

      results.push({ id: reminder.id, status: 'failed', error: e.message });
    }
  }

  return { status: 'processed', count: reminders.length, results };
}
