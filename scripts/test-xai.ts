import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testModel() {
  try {
    console.log('Testing grok-3...');
    const { text } = await generateText({
      model: xai('grok-3'),
      prompt: 'Hello, are you online?',
    });
    console.log('Response:', text);
  } catch (e) {
    console.error('Error with grok-3:', e.message);
    if (e.message.includes('503') || e.message.includes('Service Unavailable')) {
        console.log('Confirmed: grok-3 is unavailable.');
    }
  }
}

testModel();
