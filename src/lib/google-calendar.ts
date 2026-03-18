import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

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
      console.error('Error creating Google Calendar event:', error);
      throw error;
    }
  },
};
