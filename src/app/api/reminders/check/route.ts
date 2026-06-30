import { NextRequest, NextResponse } from 'next/server';
import { processDueReminders } from '@/lib/reminders';

/**
 * Legacy endpoint — kept for backward compatibility.
 * New external cron services should use /api/reminders/process instead.
 */
export async function GET(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    // Support both Bearer header and query param token
    const authHeader = req.headers.get('authorization');
    const bearerMatch = authHeader === `Bearer ${cronSecret}`;
    const url = new URL(req.url);
    const queryToken = url.searchParams.get('token');
    const tokenMatch = queryToken === cronSecret;

    if (!bearerMatch && !tokenMatch) {
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

