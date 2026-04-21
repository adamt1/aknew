import { NextRequest, NextResponse } from 'next/server';
import { processDueReminders } from '@/lib/reminders';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    // Security check: Only allow if the request has the correct Bearer token
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('Unauthorized attempt to trigger reminders check');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await processDueReminders();
    return NextResponse.json(result);

  } catch (error: any) {
    console.error('Reminder Check Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
