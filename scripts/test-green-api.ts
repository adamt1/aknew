import { greenApi } from '../src/lib/green-api';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

async function testConnection() {
  console.log('Testing Green API connection...');
  try {
    const state = await greenApi.getStateInstance();
    console.log('Instance State:', state);
    if (state.stateInstance === 'authorized') {
      console.log('✅ Success: Instance is authorized and ready!');
    } else {
      console.log(`⚠️ Warning: Instance state is "${state.stateInstance}"`);
    }
  } catch (error: any) {
    console.error('❌ Connection Failed:', error.message);
  }
}

testConnection();
