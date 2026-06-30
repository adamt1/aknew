import { NextRequest, NextResponse } from 'next/server';
import { processDueReminders } from '@/lib/reminders';

/**
 * GET /api/reminders/process?token=<CRON_SECRET>
 * 
 * Lightweight endpoint for external cron services (e.g., cron-job.org)
 * to trigger reminder processing every 2 minutes.
 * 
 * Authentication: Simple token query parameter matching CRON_SECRET.
 * This is safe because:
 * - The endpoint only reads & sends reminders (no destructive ops)
 * - processDueReminders() is idempotent (atomic status updates prevent duplicates)
 * - HTTPS encrypts the token in transit
 */
export async function GET(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error('[REMINDER_PROCESS] CRON_SECRET not configured');
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    // Auth: Accept token via query param (for external cron services)
    // or via Bearer header (for Vercel cron / manual calls)
    const url = new URL(req.url);
    const queryToken = url.searchParams.get('token');
    const authHeader = req.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    const isAuthorized = queryToken === cronSecret || bearerToken === cronSecret;

    if (!isAuthorized) {
      console.warn('[REMINDER_PROCESS] Unauthorized attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await processDueReminders();
    return NextResponse.json(result);

  } catch (error: any) {
    console.error('[REMINDER_PROCESS] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
