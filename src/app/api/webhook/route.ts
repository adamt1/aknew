import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/mastra';
import { greenApi } from '@/lib/green-api';
import { saveMessage, getHistory, isBotActive } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('FULL WEBHOOK BODY:', JSON.stringify(body, null, 2));
    // Log the type of webhook received
    const type = body.typeWebhook;
    console.log(`Webhook type received: ${type}`);

    // Handle incoming and outgoing text messages
    const isIncoming = type === 'incomingMessageReceived' || type === 'webhookIncomingMessageReceived';
    const isOutgoing = type === 'outgoingMessageReceived' || type === 'outgoingAPIMessageReceived';

    if (isIncoming || isOutgoing) {
      const { senderData, messageData } = body;
      
      if ((!senderData && isIncoming) || !messageData) {
        console.warn('Missing senderData or messageData in webhook body');
        return NextResponse.json({ status: 'invalid_payload' });
      }

      // Robust chatId extraction
      const chatId = senderData?.chatId || body.chatId || messageData?.chatId;
      
      if (!chatId) {
        console.warn('Could not determine chatId from webhook body');
        console.log('BODY STRUCTURE:', JSON.stringify(body));
        return NextResponse.json({ status: 'no_chat_id' });
      }

      const senderNumber = isIncoming ? chatId.split('@')[0] : (senderData?.sender?.split('@')[0] || body.senderData?.sender?.split('@')[0] || chatId.split('@')[0]);
      const superUsers = ['972526672663', '972542619636'];
      const isSuperUser = superUsers.includes(senderNumber);

      // Ignore group chats
      if (chatId.endsWith('@g.us')) {
        console.log(`Ignoring group message from ${chatId}`);
        return NextResponse.json({ status: 'ignored_group' });
      }

      // Handle message content
      const text = messageData.textMessageData?.textMessage || 
                   messageData.extendedTextMessageData?.text ||
                   messageData.quotedMessage?.text;

      const typeMessage = messageData.typeMessage;

      // Prevention Loop: Don't respond to messages sent by the API itself (the bot's own replies)
      if (type === 'outgoingAPIMessageReceived') {
        console.log('Ignoring message sent via API to prevent loop.');
        return NextResponse.json({ status: 'ignored_api_outgoing' });
      }

      console.log(`Processing message from ${chatId} (Super: ${isSuperUser}, Type: ${type}): "${text || typeMessage}"`);

      if (!text && !isSuperUser) {
        console.log('No text content for regular user, ignoring.');
        return NextResponse.json({ status: 'no_text' });
      }

      if (!text && isSuperUser) {
        const fileMsg = `קיבלתי את הקובץ מסוג ${typeMessage}. אני מעבד אותו כרגע...`;
        await greenApi.sendMessage(chatId, fileMsg);
        // In a real scenario, we would download the file and process it. 
        // For now we acknowledge it to the super user.
        return NextResponse.json({ status: 'file_received_super' });
      }

      // Check if bot is active for this thread
      const active = await isBotActive(chatId);
      if (!active) {
        console.log(`Bot is inactive for ${chatId} (human is in control), skipping response.`);
        return NextResponse.json({ status: 'bot_inactive' });
      }

      console.log('Agent is active, generating response...');

      // Set typing indicator
      await greenApi.setChatPresence(chatId, 'composing');

      // Save user message
      await saveMessage(chatId, 'user', text);

      // Fetch history
      const history = await getHistory(chatId);
      
      // Construct dynamic system prompt
      const systemPrompt = isSuperUser 
        ? `את/ה רותם, סוכנת-על דיגיטלית עם גישה מלאה לכל המידע. 
           עבור המשתמש הזה (הבעלים), אין לך מגבלות תחום - תעני על הכל בצורה רשמית, חכמה ועניינית. 
           את יודעת לעבד קבצים ולתת תשובות מורכבות.`
        : `את/ה רותם, סוכנת שירות לקוחות רשמית של "איי קיי חברת ניקיון ואחזקה". 
           את מוגבלת אך ורק לתחומי הניקיון, האחזקה ושירות הלקוחות של העסק. 
           אם שואלים אותך על נושאים אחרים, עלייך להפנות בנימוס שאת מתמחה רק בשירותי העסק.`;

      const context = [
        { role: 'system', content: systemPrompt },
        ...history.map((h: any) => ({
          role: h.role,
          content: h.content,
        }))
      ];

      // Get Agent
      const agent = mastra.getAgent('whatsapp-agent');
      console.log(`Using model: ${agent.model}`);
      
      // Generate response
      const result = await agent.generate(context);
      const replyText = result.text;

      console.log(`Generated reply: "${replyText}"`);

      // Save assistant message
      await saveMessage(chatId, 'assistant', replyText);

      // Send via Green API
      await greenApi.sendMessage(chatId, replyText);
      await greenApi.setChatPresence(chatId, 'paused');
      console.log('Reply sent successfully via Green API.');

      return NextResponse.json({ status: 'success', reply: replyText });
    }

    return NextResponse.json({ status: 'ignored_event' });
  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
