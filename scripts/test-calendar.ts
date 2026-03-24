import dotenv from 'dotenv';
const envResult = dotenv.config({ path: '.env.local' });
console.log('Dotenv result:', envResult.error ? 'Error' : 'Success');
console.log('GOOGLE_CLIENT_EMAIL exists:', !!process.env.GOOGLE_CLIENT_EMAIL);
console.log('GOOGLE_PRIVATE_KEY exists:', !!process.env.GOOGLE_PRIVATE_KEY);

import { googleCalendar } from './src/lib/google-calendar';

async function testCalendar() {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  console.log('Testing calendar:', calendarId);
  
  const event = {
    summary: 'Test Event from Bot Script',
    description: 'This is a test event to verify integration.',
    start: {
      dateTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      timeZone: 'Asia/Jerusalem',
    },
    end: {
      dateTime: new Date(Date.now() + 7200000).toISOString(), // 2 hours from now
      timeZone: 'Asia/Jerusalem',
    },
  };

  try {
    const result = await googleCalendar.createEvent(calendarId, event);
    console.log('Event created successfully!');
    console.log('Event link:', result.htmlLink);
  } catch (error) {
    console.error('Failed to create event:', error);
  }
}

testCalendar();
