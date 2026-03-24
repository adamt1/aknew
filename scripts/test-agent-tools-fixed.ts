const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

// Set env vars explicitly for modules that read them at top-level
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder';

const { mastra } = require('./src/mastra/index');

async function testAgentTools() {
  const agent = mastra.getAgent('whatsapp-agent');
  console.log('Testing agent:', agent.id);

  const prompt = 'רותם תקבעי לי פגישה למחר ב-10 בבוקר עם משה';
  const context = [
    { 
      role: 'system', 
      content: 'את/ה רותם, סייעת דיגיטלית של העסק. היום הוא יום רביעי, 18 במרץ 2026, השעה 11:00. תאריך מחר הוא 19 במרץ 2026. כשמבקשים ממך לקבוע פגישה, את חייבת להשתמש בכלי scheduleCalendarEvent.' 
    }
  ];

  console.log('--- GENERATING WITH maxSteps: 5 ---');
  try {
    const result = await agent.generate(prompt, {
      context: context,
      maxSteps: 5,
    });

    console.log('Final Text Response:', result.text);
    console.log('Tool Results Count:', result.toolResults?.length || 0);
    
    if (result.toolResults && result.toolResults.length > 0) {
      console.log('First Tool Result:', JSON.stringify(result.toolResults[0], null, 2));
    } else {
      console.log('No tool results found! This means the tool was NOT executed.');
    }
  } catch (error) {
    console.error('Agent execution failed:', error.message);
  }
}

testAgentTools();
