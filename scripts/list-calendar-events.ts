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
  const startOfDay = new Date();
  startOfDay.setHours(0,0,0,0);
  
  console.log('Listing events for:', calendarId, 'from', startOfDay.toISOString());
  
  try {
    const response = await calendar.events.list({
      calendarId,
      timeMin: startOfDay.toISOString(),
      maxResults: 20,
      singleEvents: true,
      orderBy: 'startTime',
    });
    const events = response.data.items;
    events.map((event) => {
      console.log(`${event.start.dateTime || event.start.date} - ${event.summary} (ID: ${event.id})`);
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listEvents();
