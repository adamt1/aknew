import { greenApi } from '@/lib/green-api';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { phoneNumber, message } = await req.json();

    if (!phoneNumber || !message) {
      return NextResponse.json(
        { error: 'Phone number and message are required' },
        { status: 400 }
      );
    }

    // Green API expects chatId in format phoneNumber@c.us
    const chatId = `${phoneNumber.replace(/\D/g, '')}@c.us`;
    
    // Disable bot for this thread (human intervention)
    await setBotStatus(chatId, false);
    
    // Save manual message to history
    await saveMessage(chatId, 'assistant', message);

    const result = await greenApi.sendMessage(chatId, message);
    
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('WhatsApp send error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
