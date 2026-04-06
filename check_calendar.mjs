import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';

// Load env from playground/.env.local or similar
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!clientEmail || !privateKey) {
  console.log('Missing credentials');
  process.exit(1);
}

const auth = new google.auth.JWT({
  email: clientEmail,
  key: privateKey,
  scopes: SCOPES,
});

const calendar = google.calendar({ version: 'v3', auth });

async function checkEvents() {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const res = await calendar.events.list({
    calendarId,
    timeMin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  });
  
  const events = res.data.items;
  if (!events || events.length === 0) {
    console.log('No upcoming events found.');
    return;
  }

  console.log('Last 10 events:');
  events.forEach((event) => {
    const start = event.start?.dateTime || event.start?.date;
    console.log(`${start} - ${event.summary} (ID: ${event.id})`);
  });
}

checkEvents().catch(console.error);
