import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/mastra';
import { greenApi } from '@/lib/green-api';
import { saveMessage, getHistory, isBotActive } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Log the type of webhook received
    const type = body.typeWebhook;
    console.log(`Webhook type received: ${type}`);

    // Handle incoming text message (different versions of Green API use different keys)
    if (type === 'incomingMessageReceived' || type === 'webhookIncomingMessageReceived') {
      const { senderData, messageData } = body;
      
      if (!senderData || !messageData) {
        console.warn('Missing senderData or messageData in webhook body');
        return NextResponse.json({ status: 'invalid_payload' });
      }

      const chatId = senderData.chatId;
      // Handle both textMessage and extendedTextMessage (like replies)
      const text = messageData.textMessageData?.textMessage || 
                   messageData.extendedTextMessageData?.text ||
                   messageData.quotedMessage?.text;

      console.log(`Processing message from ${chatId}: "${text}"`);

      if (!text) {
        console.log('No text content found in message, ignoring.');
        return NextResponse.json({ status: 'no_text' });
      }

      // Check if bot is active for this thread
      const active = await isBotActive(chatId);
      if (!active) {
        console.log(`Bot is inactive for ${chatId} (human is in control), skipping response.`);
        return NextResponse.json({ status: 'bot_inactive' });
      }

      console.log('Agent is active, generating response...');

      // Save user message
      await saveMessage(chatId, 'user', text);

      // Fetch history
      const history = await getHistory(chatId);
      const context = history.map((h: any) => ({
        role: h.role,
        content: h.content,
      }));

      // Get Agent
      const agent = mastra.getAgent('whatsapp-agent');
      
      // Generate response
      const result = await agent.generate(context);
      const replyText = result.text;

      console.log(`Generated reply: "${replyText}"`);

      // Save assistant message
      await saveMessage(chatId, 'assistant', replyText);

      // Send via Green API
      await greenApi.sendMessage(chatId, replyText);
      console.log('Reply sent successfully via Green API.');

      return NextResponse.json({ status: 'success', reply: replyText });
    }

    return NextResponse.json({ status: 'ignored_event' });
  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
