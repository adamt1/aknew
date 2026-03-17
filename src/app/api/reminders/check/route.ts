import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { greenApi } from '@/lib/green-api';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    // Security check: Only allow if the request has the correct Bearer token
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('Unauthorized attempt to trigger reminders check');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date().toISOString();

    // 1. Fetch pending reminders that are due
    const { data: reminders, error } = await supabase
      .from('reminders')
      .select('*')
      .eq('status', 'pending')
      .lte('remind_at', now);

    if (error) {
      throw new Error(`Error fetching reminders: ${error.message}`);
    }

    if (!reminders || reminders.length === 0) {
      return NextResponse.json({ status: 'no_reminders_due' });
    }

    console.log(`Processing ${reminders.length} due reminders...`);

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
        console.error(`Failed to send reminder ${reminder.id}:`, e.message);
        
        // 4. Mark as failed if transmission fails
        await supabase
          .from('reminders')
          .update({ status: 'failed' })
          .eq('id', reminder.id);

        results.push({ id: reminder.id, status: 'failed', error: e.message });
      }
    }

    return NextResponse.json({ 
      status: 'processed', 
      count: reminders.length,
      results 
    });

  } catch (error: any) {
    console.error('Reminder Check Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
