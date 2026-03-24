import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const GREEN_API_URL = process.env.GREEN_API_URL;
const GREEN_API_ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE;
const GREEN_API_TOKEN_INSTANCE = process.env.GREEN_API_TOKEN_INSTANCE;

const webhookUrl = 'https://aknew-phi.vercel.app/api/webhook';

async function updateSettings() {
  const url = `${GREEN_API_URL}/waInstance${GREEN_API_ID_INSTANCE}/SetSettings/${GREEN_API_TOKEN_INSTANCE}`;
  
  const body = {
    webhookUrl: webhookUrl,
    incomingWebhook: 'yes',
    outgoingWebhook: 'yes',
    stateWebhook: 'yes',
    outgoingMessageWebhook: 'yes',
    outgoingAPIMessageWebhook: 'yes'
  };

  console.log(`Updating Green API settings to: ${webhookUrl}`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  console.log('Response:', data);
}

updateSettings().catch(console.error);
