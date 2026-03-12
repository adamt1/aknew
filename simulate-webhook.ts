import fetch from 'node-fetch';

async function testWebhook() {
  const url = 'https://static-filament.vercel.app/api/webhook';
  const payload = {
    typeWebhook: "incomingMessageReceived",
    instanceData: { idInstance: 7103495491 },
    senderData: { 
        chatId: "972524879637-1633191221@g.us", 
        sender: "972526672663",
        senderName: "Adam"
    },
    messageData: {
      typeMessage: "textMessage",
      textMessageData: { textMessage: "שלום רותם, האם את עובדת בקבוצה?" }
    }
  };

  console.log('Sending mock webhook request...');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log('Response status:', res.status);
    console.log('Response body:', data);
  } catch (e) {
    console.error('Error:', e);
  }
}

testWebhook();
