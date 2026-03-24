const dotenv = require('dotenv');
const { google } = require('googleapis');

dotenv.config({ path: '.env.local' });

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

const auth = new google.auth.JWT({
  email: clientEmail,
  key: privateKey,
  scopes: SCOPES,
});

const calendar = google.calendar({ version: 'v3', auth });

async function listEvents() {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const startOfPeriod = new Date('2026-03-22T00:00:00Z');
  const endOfPeriod = new Date('2026-03-24T00:00:00Z');
  
  console.log('Listing events for:', calendarId, 'from', startOfPeriod.toISOString());
  
  try {
    const response = await calendar.events.list({
      calendarId,
      timeMin: startOfPeriod.toISOString(),
      timeMax: endOfPeriod.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    const events = response.data.items;
    if (events.length) {
      events.map((event) => {
        console.log(`${event.start.dateTime || event.start.date} - ${event.summary} (ID: ${event.id})`);
      });
    } else {
      console.log('No events found in this period.');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listEvents();
