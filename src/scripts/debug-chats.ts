import { greenApi, GreenChat } from '../lib/green-api';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function debug() {
  try {
    const chats = await greenApi.getChats();
    console.log(`Found ${chats.length} chats.`);
    if (chats.length > 0) {
      console.log('Sample chat 0:', JSON.stringify(chats[0], null, 2));
      console.log('Sample chat with name "משרד" (if any):', 
        chats.find((c: GreenChat) => (c.name || '').includes('משרד') || (c.name || '').includes('ועד'))
      );
    }
  } catch (e) {
    console.error(e);
  }
}
debug();
