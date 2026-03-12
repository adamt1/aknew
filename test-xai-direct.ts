import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '.env.local') });

async function main() {
  try {
    console.log('Testing @ai-sdk/xai directly...');
    const result = await generateText({
      model: xai('grok-beta'), // Trying grok-beta first
      prompt: 'Hello, how are you?',
    });
    console.log('Response:', result.text);
  } catch (error: any) {
    console.error('Error with grok-beta:', error.message);
    try {
        console.log('Testing grok-2...');
        const result2 = await generateText({
          model: xai('grok-2'),
          prompt: 'Hello, how are you?',
        });
        console.log('Response:', result2.text);
    } catch (error2: any) {
        console.error('Error with grok-2:', error2.message);
    }
  }
}

main();
