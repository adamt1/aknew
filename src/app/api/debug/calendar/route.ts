import { NextResponse } from 'next/server';
import { googleCalendar } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const rawKey = process.env.GOOGLE_PRIVATE_KEY || 'MISSING';
    
    console.log('[DEBUG_CALENDAR] Starting test connection...');
    
    // Test listing events
    const events = await googleCalendar.listEvents(calendarId, {
      timeMin: new Date().toISOString(),
      limit: 1
    });

    return NextResponse.json({
      status: 'success',
      message: 'Google Calendar connection verified!',
      details: {
        calendarId,
        clientEmail,
        eventsFound: events.length,
        keyInfo: {
          length: rawKey.length,
          startsWith: rawKey.substring(0, 30),
          endsWith: rawKey.substring(rawKey.length - 20)
        }
      }
    });

  } catch (error: any) {
    console.error('[DEBUG_CALENDAR_ERROR]', error);
    
    return NextResponse.json({
      status: 'error',
      message: error.message,
      code: error.code,
      response: error.response?.data,
      debug: {
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
        keyLength: (process.env.GOOGLE_PRIVATE_KEY || '').length,
        keyHead: (process.env.GOOGLE_PRIVATE_KEY || '').substring(0, 30)
      }
    }, { status: 500 });
  }
}
