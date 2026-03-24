async function testWebhook() {
  const url = 'https://aknew-phi.vercel.app/api/webhook';
  
  const payload = {
    "typeWebhook": "incomingMessageReceived",
    "instanceData": {
      "idInstance": 7103495491,
      "wid": "972526672663@c.us",
      "typeInstance": "whatsapp"
    },
    "timestamp": 1741804535,
    "idMessage": "3EB04D0D2D7D1D2D3D4D",
    "senderData": {
      "chatId": "972526672663@c.us",
      "sender": "972526672663@c.us",
      "senderName": "Owner"
    },
    "messageData": {
      "typeMessage": "textMessage",
      "textMessageData": {
        "textMessage": "היי רותם, תשלחי לי מתכון לפיצה בבקשה"
      }
    }
  };

  console.log(`Sending mock webhook to: ${url}`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  console.log('Response Status:', response.status);
  console.log('Response Body:', JSON.stringify(data, null, 2));
}

testWebhook().catch(console.error);
