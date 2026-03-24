require('dotenv').config({ path: '.env.local' });

const { mastra } = require('./src/mastra');

async function debugToolCalling() {
  const agent = mastra.getAgent('whatsapp-agent');
  console.log('Testing agent:', agent.id);

  const testPrompt = 'תקבע לי פגישה למחר ב-10:00 עם יוסי';
  console.log('Prompt:', testPrompt);

  try {
    const result = await agent.generate(testPrompt, {
      maxSteps: 3,
      toolChoice: 'required',
    });

    console.log('--- RESULT ---');
    console.log('Text:', result.text);
    console.log('Tool Calls (results):', JSON.stringify(result.toolResults, null, 2));
    console.log('Steps:', result.steps.length);
  } catch (error) {
    console.error('Error during generation:', error);
  }
}

debugToolCalling();
