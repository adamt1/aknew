import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { mastra } from './src/mastra';

async function testAgentTools() {
  const agent = mastra.getAgent('whatsapp-agent');
  console.log('Testing agent:', agent.id);

  const prompt = 'רותם תקבעי לי פגישה למחר ב-10 בבוקר עם משה';
  const context = [
    { 
      role: 'system', 
      content: `את/ה רותם, סייעת דיגיטלית. היום הוא יום רביעי, 18 במרץ 2026, השעה 11:00. ` 
    }
  ];

  console.log('--- GENERATING WITH maxSteps: 5 ---');
  try {
    const result = await agent.generate(prompt, {
      context: context as any,
      maxSteps: 5,
    });

    console.log('Final Text Response:', result.text);
    console.log('Tool Results Count:', result.toolResults?.length || 0);
    
    if (result.toolResults && result.toolResults.length > 0) {
      console.log('First Tool Result:', JSON.stringify(result.toolResults[0], null, 2));
    }
  } catch (error: any) {
    console.error('Agent execution failed:', error.message);
  }
}

testAgentTools();
