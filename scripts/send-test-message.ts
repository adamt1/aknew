import { greenApi } from '../src/lib/green-api';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

async function sendTestMessage() {
  const phoneNumber = '972526672663';
  const chatId = `${phoneNumber}@c.us`;
  const message = 'שלום! זו הודעת בדיקה מ-Green API דרך Next.js 🚀';

  console.log(`Sending test message to ${phoneNumber}...`);
  try {
    const result = await greenApi.sendMessage(chatId, message);
    console.log('✅ Message sent successfully!');
    console.log('Result:', result);
  } catch (error: any) {
    console.error('❌ Failed to send message:', error.message);
  }
}

sendTestMessage();
