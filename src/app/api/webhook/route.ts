import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/mastra';
import { greenApi } from '@/lib/green-api';
import { saveMessage, getHistory, isBotActive } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('Incoming Webhook:', JSON.stringify(body, null, 2));

    // Handle incoming text message
    if (body.typeWebhook === 'incomingMessageReceived') {
      const { senderData, messageData } = body;
      const chatId = senderData.chatId;
      const text = messageData.textMessageData?.textMessage;

      if (!text) return NextResponse.json({ status: 'no_text' });

      // Check if bot is active for this thread
      const active = await isBotActive(chatId);
      if (!active) {
        console.log(`Bot is inactive for ${chatId}, skipping response.`);
        return NextResponse.json({ status: 'bot_inactive' });
      }

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

      // Save assistant message
      await saveMessage(chatId, 'assistant', replyText);

      // Send via Green API
      await greenApi.sendMessage(chatId, replyText);

      return NextResponse.json({ status: 'success', reply: replyText });
    }

    return NextResponse.json({ status: 'ignored_event' });
  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
