import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function testXAI() {
  const apiKey = process.env.XAI_API_KEY;
  console.log('Using API Key:', apiKey?.substring(0, 10) + '...');

  const url = 'https://api.x.ai/v1/chat/completions';
  const body = {
    model: 'grok-beta',
    messages: [{ role: 'user', content: 'Say hello' }]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  console.log('Response:', JSON.stringify(data, null, 2));
}

testXAI().catch(console.error);
