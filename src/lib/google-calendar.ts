import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';

/**
 * NUCLEAR SANITIZER:
 * Handles:
 * 1. Surrounding double/single quotes.
 * 2. Mixed escaped newlines (\\n vs \n).
 * 3. Leading/trailing whitespace.
 */
function nuclearSanitizeKey(key: string): string {
  let cleaned = key.trim();
  
  // Strip quotes
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  }
  
  // Fix newlines: handle both literal and escaped versions
  cleaned = cleaned.replace(/\\n/g, '\n');
  
  return cleaned;
}

const sanitizedKey = nuclearSanitizeKey(privateKey);

if (sanitizedKey) {
   console.log(`[GOOGLE_AUTH_DEBUG] Sanitized Key Length: ${sanitizedKey.length}, Head: ${sanitizedKey.substring(0, 30)}...`);
}

if (!clientEmail || !sanitizedKey) {
  console.warn('Google Calendar credentials not fully configured (GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY)');
}

const auth = new google.auth.JWT({
  email: clientEmail,
  key: sanitizedKey,
  scopes: SCOPES,
});

export const calendar = google.calendar({ version: 'v3', auth });

export interface CalendarEventPayload {
  summary: string;
  description?: string;
  start: {
    dateTime: string; // ISO-8601
    timeZone: string;
  };
  end: {
    dateTime: string; // ISO-8601
    timeZone: string;
  };
  reminders?: {
    useDefault: boolean;
    overrides: Array<{ method: string; minutes: number }>;
  };
}

export const googleCalendar = {
  createEvent: async (calendarId: string, event: CalendarEventPayload) => {
    try {
      const response = await calendar.events.insert({
        calendarId,
        requestBody: event,
      });
      return response.data;
    } catch (error: any) {
      console.error('[GOOGLE_CALENDAR_API_ERROR] Detail:', {
        message: error.message,
        code: error.code,
        status: error.status,
        response: error.response?.data
      });
      throw error;
    }
  },
  listEvents: async (calendarId: string, options: any = {}) => {
    try {
      const response = await calendar.events.list({
        calendarId,
        timeMin: options.timeMin,
        q: options.q,
        singleEvents: true,
      });
      return response.data.items || [];
    } catch (error: any) {
      console.error('Error listing Google Calendar events:', error);
      return [];
    }
  },
};
