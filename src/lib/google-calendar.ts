import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';

// SANITIZE: Remove potential quotes added by user in Vercel UI
privateKey = privateKey.trim();
if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
  privateKey = privateKey.substring(1, privateKey.length - 1);
}

// SANITIZE: Handle literal newlines and escaped newlines (\n)
privateKey = privateKey.replace(/\\n/g, '\n');

// DIAGNOSTIC LOG (REDACTED)
if (privateKey) {
   console.log(`[GOOGLE_AUTH_DEBUG] Key Length: ${privateKey.length}, StartsWith: ${privateKey.substring(0, 30)}...`);
}

if (!clientEmail || !privateKey) {
  console.warn('Google Calendar credentials not fully configured (GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY)');
}

const auth = new google.auth.JWT({
  email: clientEmail,
  key: privateKey,
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
