const dotenv = require('dotenv');
const { google } = require('googleapis');

dotenv.config({ path: '.env.local' });

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!clientEmail || !privateKey) {
  console.error('Credentials missing!', { clientEmail, hasKey: !!privateKey });
  process.exit(1);
}

const auth = new google.auth.JWT({
  email: clientEmail,
  key: privateKey,
  scopes: SCOPES,
});

const calendar = google.calendar({ version: 'v3', auth });

async function testCalendar() {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  console.log('Testing calendar:', calendarId);
  
  const event = {
    summary: 'Test Event from Bot Script (Fixed)',
    description: 'This is a test event to verify integration.',
    start: {
      dateTime: new Date(Date.now() + 3600000).toISOString(),
      timeZone: 'Asia/Jerusalem',
    },
    end: {
      dateTime: new Date(Date.now() + 7200000).toISOString(),
      timeZone: 'Asia/Jerusalem',
    },
  };

  try {
    const response = await calendar.events.insert({
      calendarId,
      requestBody: event,
    });
    console.log('Event created successfully!');
    console.log('Event link:', response.data.htmlLink);
  } catch (error) {
    console.error('Failed to create event:', error.message);
    if (error.response?.data) {
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testCalendar();
