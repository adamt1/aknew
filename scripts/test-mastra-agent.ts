
import * as fs from 'fs';
import * as path from 'path';

const envFile = fs.readFileSync('.env.local', 'utf8');
envFile.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    const value = valueParts.join('=').trim().replace(/^"(.*)"$/, '$1').replace(/'(.*)'$/, '$1');
    process.env[key.trim()] = value;
  }
});

import { mastra } from '../src/mastra';

async function testAgent() {
  const agent = mastra.getAgent('whatsapp-agent');
  const text = 'קבעי לי פגישה עם רותם ליום שישי ב-12:00';
  
  console.log('Testing Agent with text:', text);
  
  const result = await agent.generate(text, {
    context: [
        { role: 'system', content: 'You are a helpful assistant. Today is Wednesday, March 18, 2026.' }
    ]
  });

  console.log('FINAL TEXT:', result.text);
  console.log('TOOL RESULTS:', JSON.stringify(result.toolResults, null, 2));
}

testAgent();
