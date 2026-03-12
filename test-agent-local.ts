import { mastra } from './src/mastra';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '.env.local') });

async function main() {
  try {
    const agent = mastra.getAgent('whatsapp-agent');
    console.log('Generating response for "היי רותם"...');
    const result = await agent.generate('היי רותם');
    console.log('Response:', result.text);
  } catch (error: any) {
    console.error('Error:', error);
  }
}

main();
