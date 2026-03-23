import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/mastra';
import { greenApi } from '@/lib/green-api';
import { saveMessage, getHistory, isBotActive, setBotStatus } from '@/lib/supabase';
import { elevenLabs } from '@/lib/elevenlabs';

export async function POST(req: NextRequest) {
  const APP_VERSION = 'v4.0-TIMEFIX';
  console.time(`[${APP_VERSION}] webhook-total`);

  let body: any = {};
  try {
    try {
      body = await req.json();
    } catch (e) {
      console.warn('Failed to parse webhook body');
      return NextResponse.json({ status: 'invalid_json' });
    }
    console.log('FULL WEBHOOK BODY:', JSON.stringify(body, null, 2));
    const type = body.typeWebhook;

    const isIncoming = type === 'incomingMessageReceived' || type === 'webhookIncomingMessageReceived';
    const isOutgoing = type === 'outgoingMessageReceived' || type === 'outgoingAPIMessageReceived';

    if (isIncoming || isOutgoing) {
      const { senderData, messageData } = body;
      
      if ((!senderData && isIncoming) || !messageData) {
        console.warn('Missing senderData or messageData in webhook body');
        return NextResponse.json({ status: 'invalid_payload' });
      }

      const chatId = senderData?.chatId || body.chatId || messageData?.chatId;
      const wid = body.instanceData?.wid;
      const rawSender = isIncoming ? senderData?.sender : (senderData?.sender || body.senderData?.sender || chatId);
      const rawSenderClean = (rawSender || '').replace(/\D/g, '');
      const chatIdClean = chatId.replace(/\D/g, '');
      const widNumber = (wid || '').split('@')[0].replace(/\D/g, '').trim();
      
      const superUsers = ['972526672663', '0526672663', '526672663'];
      const isSuperUser = superUsers.some(u => 
        rawSenderClean.includes(u) || 
        chatIdClean.includes(u) ||
        (rawSenderClean.length >= 9 && u.endsWith(rawSenderClean.slice(-9)))
      ) || (widNumber && (rawSenderClean.includes(widNumber) || chatIdClean.includes(widNumber)));

      if (chatId.endsWith('@g.us')) {
        console.log(`Ignoring group message from ${chatId}`);
        return NextResponse.json({ status: 'ignored_group' });
      }

      let contactName = '';
      try {
        const contactInfo = await greenApi.getContactInfo(chatId);
        contactName = contactInfo.contactName || '';
      } catch (e) {
        contactName = senderData?.senderName || '';
      }

      const pushName = senderData?.senderName || '';
      const senderName = pushName || contactName || '';

      // Filters
      const blacklist = ['אמא', 'Mom', 'אוריה חיים שלי', 'אריאלי', 'שלומי ידיד', 'קימי', 'קארין'];
      const blacklistedNumbers = ['972542619636', '0542619636', '542619636'];
      
      const isBlacklisted = (isIncoming && !isSuperUser && (
        blacklist.some(name => (senderName && senderName.includes(name))) ||
        blacklistedNumbers.some(num => (chatIdClean && chatIdClean.includes(num)))
      ));

      if (isBlacklisted) {
        console.log(`[FILTER] Explicitly ignored blacklisted contact: ${senderName} (${chatId})`);
        return NextResponse.json({ status: 'ignored_blacklisted' });
      }

      let text = messageData.textMessageData?.textMessage || 
                   messageData.extendedTextMessageData?.text ||
                   messageData.quotedMessage?.text ||
                   messageData.imageMessageData?.caption ||
                   messageData.videoMessageData?.caption ||
                   messageData.documentMessageData?.caption ||
                   messageData.fileMessageData?.caption;

      const typeMessage = messageData.typeMessage;
      const isVoiceMessage = typeMessage === 'audioMessage';

      if (type === 'outgoingAPIMessageReceived') {
        return NextResponse.json({ status: 'ignored_api_outgoing' });
      }

      if (isOutgoing && isSuperUser) {
        if (chatId !== rawSender && (!wid || !chatId.includes(widNumber))) {
          console.log(`[HUMAN_INTERVENTION] Owner messaged ${chatId}. Disabling bot.`);
          await setBotStatus(chatId, false);
          return NextResponse.json({ status: 'bot_disabled_by_owner' });
        }
      }

      const botTypes = ['templateMessage', 'buttonsMessage', 'listMessage', 'buttonsResponseMessage', 'listResponseMessage', 'templateResponseMessage'];
      const isBotMessageType = botTypes.includes(typeMessage);
      const isBotInName = senderName.toLowerCase().includes('bot') || senderName.includes('בוט');

      if (isIncoming && (isBotMessageType || isBotInName)) {
        console.log(`[BOT_DETECTION] Ignoring message from potential bot: "${senderName}" (Type: ${typeMessage})`);
        return NextResponse.json({ status: 'ignored_bot' });
      }

      const active = await isBotActive(chatId);
      if (!active && !isSuperUser) {
        return NextResponse.json({ status: 'bot_inactive' });
      }

      let fileData: { type: 'image'; image: string; mimeType: string } | null = null;
      const isImage = typeMessage === 'imageMessage';
      const isDocument = typeMessage === 'documentMessage';

      if (isVoiceMessage) {
        const downloadUrl = messageData.fileMessageData?.downloadUrl;
        const idMessage = body.idMessage;
        if (downloadUrl) {
           try {
             const audioBuffer = await greenApi.downloadFile(downloadUrl);
             text = await elevenLabs.speechToText(audioBuffer);
           } catch (e: any) {
             console.error(`[STT Error] ${e.message}`);
             return NextResponse.json({ status: 'stt_failed' });
           }
        } else if (idMessage) {
           try {
             const audioBuffer = await greenApi.downloadFileByMessage(chatId, idMessage);
             text = await elevenLabs.speechToText(audioBuffer);
           } catch (e: any) {
             console.error(`[STT Error via messageId] ${e.message}`);
           }
        }
      } else if (isImage || isDocument) {
        const downloadUrl = messageData.fileMessageData?.downloadUrl || 
                            messageData.imageMessageData?.downloadUrl || 
                            messageData.documentMessageData?.downloadUrl;
        
        const idMessage = body.idMessage;
        const mimeType = messageData.fileMessageData?.mimeType || 
                         messageData.imageMessageData?.mimeType || 
                         messageData.documentMessageData?.mimeType || 
                         (isImage ? 'image/jpeg' : 'application/pdf');

        try {
          let fileBuffer: Buffer | null = null;
          if (downloadUrl) {
            console.log(`[VISION] Downloading via URL: ${downloadUrl}`);
            fileBuffer = await greenApi.downloadFile(downloadUrl);
          } else if (idMessage) {
            console.log(`[VISION] Downloading via MessageId: ${idMessage}`);
            fileBuffer = await greenApi.downloadFileByMessage(chatId, idMessage);
          }

          if (fileBuffer) {
            console.log(`[DEBUG] Downloaded buffer: size=${fileBuffer.length}, header=${fileBuffer.slice(0, 10).toString('hex')}`);
            fileData = {
              type: 'image',
              image: fileBuffer,
              mimeType
            } as any;
            if (!text) text = `[${isImage ? 'תמונה' : 'מסמך'} שצורף]`;
          }
        } catch (e: any) {
          console.error(`[Vision Error] ${e.message}`);
        }
      }

      await greenApi.setChatPresence(chatId, isVoiceMessage ? 'recording' : 'composing');
      const placeholder = isVoiceMessage ? '[הודעה קולית]' : '[קובץ/תמונה]';
      await saveMessage(chatId, 'user', text || placeholder);
      const history = await getHistory(chatId);

      // Time Calculations - CRITICAL FIX
      const messageDate = body.timestamp ? new Date(body.timestamp * 1000) : new Date();
      const serverDate = new Date();
      
      const dateStrHe = messageDate.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const timeStrHe = messageDate.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false });
      const serverTimeHe = serverDate.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false });
      const isSignificantDelay = Math.abs(serverDate.getTime() - messageDate.getTime()) > 3600000; // > 1 hour

      const globalStandard = `
        הנחיות קריטיות לעיצוב וסגנון:
        - **מלל העסק**: השתמשי תמיד בביטוי "הנציגה הדיגיטלית של איי קיי חברת ניקיון ואחזקה".
        - **יישור לימין**: כל שורה חייבת להתחיל בתו ה-RLM הסמוי מטקסט (\u200F).
        - **טון דיבור**: לבבית, חייכנית ושירותית 😊✨. השתמשי באימוג'ים שמחים.
      `;

      const authInstructions = `
        הנחיות קריטיות (Authoritative Context):
        - היום הוא יום ${dateStrHe}. 
        - השעה המקומית כרגע (בישראל): ${serverTimeHe}.
        - זמן שליחת ההודעה שקיבלת מהלקוח: ${timeStrHe}.
        ${isSignificantDelay ? '- שימי לב: ההודעה התקבלה בעיכוב משמעותי של מעל שעה. אם רלוונטי, התנצלי על העיכוב בתגובה.' : ''}
        - תמיד השתמשי בתאריך ובשעה אלו כמקור היחיד והקובע למושגים כמו "היום", "עכשיו", "מחר" וכו'.
        - השנה היא 2026.
        
        סגנון וכללים:
        ${globalStandard}
        - שם השולח/ת: ${senderName}.
        - האם השולח הוא הבעלים (אדם)? ${isSuperUser ? 'כן' : 'לא'}.
        - מידע חשוב: אדם (Adam) הוא הבעלים של העסק. אם השולח פונה ב-"היי אדם" או דומה, הוא מתכוון לבעלים.
      `;

      const schedulingKeywords = ['תקבע', 'פגישה', 'ביומן', 'לוז', 'לסגור', 'פגשיה'];
      const isSchedulingIntent = schedulingKeywords.some(k => text?.toLowerCase().includes(k));
      
      let toolResultSummary = '';
      let manualLink = ''; 
      
      const agent = mastra.getAgent('whatsapp-agent');

      if (isSchedulingIntent) {
        if (isSuperUser) {
          console.log(`[STABLE_FIX] Scheduling intent detected by Owner.`);
          try {
            const extractionPrompt = `חלץ פרטי פגישה מטקסט: "${text}". 
              היום הוא יום ${dateStrHe}, השעה הנוכחית ${serverTimeHe}. 
              החזר JSON בלבד: { "summary": "...", "start_time": "ISO", "end_time": "ISO", "description": "..." }`;
            
            const extractionResult = await agent.generate(extractionPrompt, { 
              maxSteps: 1,
              instructions: `את עוזרת חכמה לחילוץ זמנים. היום הוא יום ${dateStrHe}, שעה ${serverTimeHe}. חלץ ISO תקין לפי ירושלים.` 
            });
            const jsonMatch = extractionResult.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const params = JSON.parse(jsonMatch[0]);
              console.log(`[STABLE_FIX] Extracted parameters:`, params);
              const tools = await agent.listTools();
              const executeResult = await (tools as any).scheduleCalendarEvent.execute({
                ...params,
                calendar_id: process.env.GOOGLE_CALENDAR_ID || 'primary'
              });
              
              toolResultSummary = `\n\n[כלי היומן בוצע! תוצאה: ${executeResult.message}]`;
              manualLink = executeResult.add_to_your_calendar_link || '';
            }
          } catch (e: any) {
            console.error(`[STABLE_FIX] Manual tooling failed: ${e.message}`);
            toolResultSummary = `\n\n[שגיאה בקביעת הפגישה - ${e.message}]`;
          }
        } else {
          console.log(`[STABLE_FIX] Scheduling intent by non-owner. Notifying Adam.`);
          try {
            const ownerChatId = '972526672663@c.us';
            const notificationText = `\u200F🔔 *בקשה לקביעת פגישה!*
\u200Fמאת: ${senderName} (${chatId})
\u200Fההודעה: "${text}"
\u200Fהזמן: יום ${dateStrHe}, שעה ${timeStrHe}.

\u200Fרותם הודיעה שזה הועבר לאישורך.`;
            await greenApi.sendMessage(ownerChatId, notificationText);
            toolResultSummary = `\n\n[הודעת עדכון נשלחה לאדם לאישור פגישה. אל תנסי לקבוע בעצמך ביומן!]`;
          } catch (e: any) {
            console.error(`[STABLE_FIX] Owner notification failed: ${e.message}`);
          }
        }
      }

      if (isSuperUser) {
        await greenApi.sendMessage(chatId, `\u200F🔍 רותם מתחילה לעבד את הבקשה... (${isImage ? 'תמונה' : 'טקסט'})`);
      }

      // Build messages array for the agent
      const historyLegacy = history.filter((h: any) => h.content !== text && h.content !== placeholder).slice(-5);
      
      const promptContent: any[] = [{ type: 'text', text: text || 'שלום' }];
      if (fileData) {
        promptContent.push(fileData);
      }

      const messages: any[] = [
        ...historyLegacy.map((h: any) => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.content,
        })),
        { role: 'user', content: promptContent }
      ];

      // Deduplication: If we already sent a message in the last 5 seconds to this chat, 
      const lastAssistantMessage = history.filter((h: any) => h.role === 'assistant').pop();
      if (lastAssistantMessage) {
        const lastTime = new Date(lastAssistantMessage.created_at).getTime();
        const now = new Date().getTime();
        if (now - lastTime < 5000) { // 5 seconds
          console.log(`[DEDUPLICATION] Skipping response to ${chatId} - too soon since last reply.`);
           return NextResponse.json({ status: 'success_deduplicated' });
        }
      }

      console.time(`[${APP_VERSION}] agent-generate`);
      // Reorder: Image first often works better for some vision models
      const promptContentParts: any[] = [];
      if (fileData) {
        promptContentParts.push(fileData);
      }
      promptContentParts.push({ type: 'text', text: text || 'שלום' });

      const messages: any[] = [
        ...historyLegacy.map((h: any) => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.content,
        })),
        { role: 'user', content: promptContentParts }
      ];

      const result = await agent.generate(messages, { 
        maxSteps: 3,
        instructions: authInstructions + (toolResultSummary ? `\n\n${toolResultSummary}` : '')
      });
      console.timeEnd(`[${APP_VERSION}] agent-generate`);

      if (isSuperUser) {
        await greenApi.sendMessage(chatId, `\u200F✅ העיבוד הושלם, מפיקה תשובה...`);
      }

      let replyText = result.text || 'סליחה, נתקלתי בבעיה קטנה.';

      if (manualLink && !replyText.includes(manualLink)) {
        replyText += `\n\nלחץ כאן כדי להוסיף ליומן שלך: ${manualLink}`;
      }

      await saveMessage(chatId, 'assistant', replyText);

      if (isVoiceMessage) {
         try {
           await greenApi.sendMessage(chatId, replyText);
           let ttsText = replyText;
           if (manualLink) {
             const linkLine = `\n\nלחץ כאן כדי להוסיף ליומן שלך: ${manualLink}`;
             ttsText = replyText.replace(linkLine, '').trim();
           }
           ttsText = ttsText.replace(/https?:\/\/[^\s]+/g, '').trim();

           const ttsBuffer = await elevenLabs.textToSpeech(ttsText);
           const uploadUrl = await greenApi.uploadFile(ttsBuffer, 'audio/mpeg', 'reply.mp3');
           await greenApi.sendFileByUrl(chatId, uploadUrl, 'reply.mp3');
         } catch (e: any) {
           console.error(`[TTS Error] ${e.message}`);
         }
      } else {
         await greenApi.sendMessage(chatId, replyText);
      }
      
      await greenApi.setChatPresence(chatId, 'paused');
      console.timeEnd(`[${APP_VERSION}] webhook-total`);
      return NextResponse.json({ status: 'success', reply: replyText });
    }

    return NextResponse.json({ status: 'ignored_event' });
  } catch (error: any) {
    console.error('Webhook Error:', error);
    
    // Attempt to notify owner of the crash if possible
    try {
      const chatId = body?.senderData?.chatId || body?.chatId;
      if (chatId) {
        await greenApi.sendMessage(chatId, `\u200F⚠️ *שגיאת מערכת:* ${error.message}\n\nהבוט נתקל בבעיה וקרס. רותם עדיין לומדת... 🛠️`);
      }
    } catch (e) {
      console.error('Failed to send error message:', e);
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
