import { NextResponse } from 'next/server';
import { mastra } from '@/mastra';
import { greenApi } from '@/lib/green-api';
import { elevenLabs } from '@/lib/elevenlabs';
import { saveMessage, getHistory, setBotStatus, getBotStatus } from '@/lib/supabase';

export const maxDuration = 60; // Increase timeout for reasoning models

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log('Webhook received:', JSON.stringify(body, null, 2));

    const type = body.typeWebhook;
    const isIncoming = type === 'incomingMessageReceived';
    const isOutgoing = type === 'outgoingMessageReceived';
    
    const senderData = body.senderData;
    const messageData = body.messageData;
    const chatId = body.chatId || senderData?.chatId;

    if ((isIncoming || isOutgoing) && chatId && !chatId.includes('@g.us')) {
      const text = messageData?.textMessageData?.textMessage || 
                   messageData?.extendedTextMessageData?.text || 
                   '';
      
      const senderNumber = (senderData?.sender || '').split('@')[0].replace(/\D/g, '');
      const superUsers = ['972526672663', '972542619636', '0526672663', '0542619636', '526672663', '542619636'];
      const isSuperUser = superUsers.some(u => senderNumber.endsWith(u.slice(-9)));

      console.log(`[AUTH] sender=${senderNumber}, isSuperUser=${isSuperUser}`);

      // Human Intervention logic
      if (isOutgoing && isSuperUser) {
        await setBotStatus(chatId, false);
        return NextResponse.json({ status: 'bot_paused_by_owner' });
      }

      if (isIncoming && isSuperUser && (text.includes('חזור') || text.includes('תמשיך'))) {
        await setBotStatus(chatId, true);
        await greenApi.sendMessage(chatId, '✅ חזרתי לעבוד! במה אוכל לעזור?');
        return NextResponse.json({ status: 'bot_resumed_by_owner' });
      }

      const isBotActive = await getBotStatus(chatId);
      if (!isBotActive && !isSuperUser) {
        return NextResponse.json({ status: 'bot_paused' });
      }

      // Blacklist (Check profile name and saved contact name)
      let contactName = '';
      try {
        const info = await greenApi.getContactInfo(chatId);
        contactName = info.contactName || '';
      } catch (e) {}
      
      const pushName = senderData?.senderName || '';
      const blacklist = ['קארין', 'Karin', 'אמא', 'Mom', 'אוריה חיים שלי', 'אריאלי', 'שלומי ידיד', 'קימי'];
      const isBlacklisted = blacklist.some(name => pushName.includes(name) || contactName.includes(name));

      if (isIncoming && !isSuperUser && isBlacklisted) {
        return NextResponse.json({ status: 'ignored_blacklisted' });
      }

      // Save and Get History
      if (isIncoming) await saveMessage(chatId, 'user', text);
      const history = await getHistory(chatId);

      // System Prompt Construction
      const now = new Date();
      const dateStr = now.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
      const timeStr = now.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem' });

      const openingTemplate = `
\u200F*שלום רב,*  
\u200Fאני רותם, הנציגה הדיגיטלית של 'איי קיי חברת ניקיון ואחזקה' 🧹. 
\u200Fבמה אוכל לעזור? אנא בחרו:
\u200F1️⃣ **לקוח חדש** 🏢
\u200F2️⃣ **לקוח קיים** 🛠️
\u200F3️⃣ **אחר** 💬`;

      const globalSystem = `אתה רותם, נציגה לבבית של "איי קיי חברת ניקיון ואחזקה". 
היום: ${dateStr}, שעה: ${timeStr}.
הנחיות:
- יישור לימין: תמיד תתחילי בתו \u200F.
- טון דיבור: שירותי וחייכני 😊.
- כלים: יש לך כלים לקביעת פגישות ביומן גוגל, תזכורות והפקת מסמכים.
${isSuperUser ? 'המשתמש הנוכחי הוא הבעלים שלך. עני לו בצורה עניינית ומקצועית ללא הגבלות.' : ''}
${history.length === 0 ? `זו הודעה ראשונה. שלחי את הודעת הפתיחה הבאה:\n${openingTemplate}` : ''}`;

      const context = [
        { role: 'system', content: globalSystem },
        ...history.map((h: any) => ({ role: h.role, content: h.content }))
      ];

      // Generate Agent Response
      const agent = mastra.getAgent('whatsapp-agent');
      const result = await agent.generate(context);
      const replyText = result.text;

      await saveMessage(chatId, 'assistant', replyText);
      await greenApi.sendMessage(chatId, replyText);

      return NextResponse.json({ status: 'success', reply: replyText });
    }

    return NextResponse.json({ status: 'ignored' });
  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
