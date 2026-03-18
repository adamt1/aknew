import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/mastra';
import { greenApi } from '@/lib/green-api';
import { saveMessage, getHistory, isBotActive, setBotStatus } from '@/lib/supabase';
import { elevenLabs } from '@/lib/elevenlabs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('FULL WEBHOOK BODY:', JSON.stringify(body, null, 2));
    // Log the type of webhook received
    const type = body.typeWebhook;
    const APP_VERSION = 'v2.2-voice';
    console.log(`[${APP_VERSION}] Webhook received: ${type}`);

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
      const wid = body.instanceData?.wid;
      const rawSender = isIncoming ? senderData?.sender : (senderData?.sender || body.senderData?.sender || chatId);
      const senderNumber = (rawSender || '').split('@')[0].replace(/\D/g, '').trim();
      const widNumber = (wid || '').split('@')[0].replace(/\D/g, '').trim();
      
      const superUsers = ['972526672663', '972542619636', '0526672663', '0542619636', '526672663', '542619636'];
      // Robust super user detection
      const cleanSender = (senderData?.sender || '').replace(/\D/g, ''); 
      const isSuperUser = superUsers.some(u => 
        cleanSender === u || 
        (cleanSender.length >= 9 && u.endsWith(cleanSender.slice(-9)))
      ) || (widNumber && cleanSender.includes(widNumber));

      console.log(`[AUTH_DEBUG] type=${type}, senderNumber="${senderNumber}", cleanSender="${cleanSender}", widNumber="${widNumber}", isSuperUser=${isSuperUser}`);

      // Ignore group chats
      if (chatId.endsWith('@g.us')) {
        console.log(`Ignoring group message from ${chatId}`);
        return NextResponse.json({ status: 'ignored_group' });
      }

      // Fetch contact name for classification
      let contactName = '';
      try {
        const contactInfo = await greenApi.getContactInfo(chatId);
        contactName = contactInfo.contactName || '';
        console.log(`[FILTER_DEBUG] Contact Name for ${chatId}: "${contactName}"`);
      } catch (e) {
        console.warn(`Failed to fetch contact info for ${chatId}`);
      }

      const isOfficeOrCommittee = contactName.includes('משרד') || contactName.includes('ועד בית');
      const isNewNumber = !contactName || contactName.trim() === ''; 
      
      // STRICT FILTERING RULES:
      const shouldIgnore = !isSuperUser && !isNewNumber && !isOfficeOrCommittee;

      if (isIncoming && shouldIgnore) {
        console.log(`[FILTER] Ignoring message from "${contactName}" (${chatId}) - Not a target contact.`);
        return NextResponse.json({ status: 'ignored_by_filter' });
      }

      // Explicit Blacklist (Additional safety)
      const blacklist = ['אמא', 'Mom', 'אוריה חיים שלי', 'אריאלי', 'שלומי ידיד', 'קימי'];
      const pushName = senderData?.senderName || '';
      if (isIncoming && !isSuperUser && blacklist.some(name => (pushName && pushName.includes(name)) || (contactName && contactName.includes(name)))) {
        console.log(`[FILTER] Explicitly ignored blacklisted contact: ${contactName || pushName}`);
        return NextResponse.json({ status: 'ignored_blacklisted' });
      }

      // Handle message content
      let text = messageData.textMessageData?.textMessage || 
                   messageData.extendedTextMessageData?.text ||
                   messageData.quotedMessage?.text;

      const typeMessage = messageData.typeMessage;
      const isVoiceMessage = typeMessage === 'audioMessage';

      // Prevention Loop: Don't respond to messages sent by the API itself
      if (type === 'outgoingAPIMessageReceived') {
        return NextResponse.json({ status: 'ignored_api_outgoing' });
      }

      // Human Intervention Logic
      if (isOutgoing && isSuperUser) {
        if (chatId !== rawSender && (!wid || !chatId.includes(widNumber))) {
          console.log(`[HUMAN_INTERVENTION] Owner ${senderNumber} messaged ${chatId}. Disabling bot.`);
          await setBotStatus(chatId, false);
          return NextResponse.json({ status: 'bot_disabled_by_owner' });
        }
      }

      // Voice message transcription
      if (isVoiceMessage) {
        const downloadUrl = messageData.fileMessageData?.downloadUrl;
        if (downloadUrl) {
           try {
             const audioBuffer = await greenApi.downloadFile(downloadUrl);
             text = await elevenLabs.speechToText(audioBuffer);
           } catch (e: any) {
             console.error(`[STT Error] ${e.message}`);
             return NextResponse.json({ status: 'stt_failed' });
           }
        }
      }

      // Check if bot is active for this thread
      const active = await isBotActive(chatId);
      if (!active && !isSuperUser) {
        return NextResponse.json({ status: 'bot_inactive' });
      }

      // TYPING INDICATOR
      await greenApi.setChatPresence(chatId, isVoiceMessage ? 'recording' : 'composing');

      // Save user message
      await saveMessage(chatId, 'user', text || '[Voice Message]');

      // Fetch history
      const history = await getHistory(chatId);
      console.log(`[LOG] chatId=${chatId}, historyLength=${history.length}, isSuperUser=${isSuperUser}`);

      // Use message timestamp for better accuracy, fallback to server time
      const now = body.timestamp ? new Date(body.timestamp * 1000) : new Date();
      console.log(`[TIME_DEBUG] Server: ${new Date().toISOString()}, Message: ${now.toISOString()}, GreenTimestamp: ${body.timestamp}`);
      
      const senderName = pushName || contactName || '';

      // Force Opening Message decision
      // We only force it if history is 0 AND it's not a SuperUser
      const shouldForceOpening = !isSuperUser && history.length === 0;

      // Ensure we use Israel TimeZone specifically
      const dateStr = now.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
      
      // Force Loop Break: If the user asks for the opening message, we ignore history to prevent copy-pasting the old format
      const isAskingForOpening = text?.includes('הודעת פתיחה') || text?.includes('הודעת הפתיחה');

      const isoStr = now.toISOString();
      const epochSeconds = Math.floor(now.getTime() / 1000);

      // Standard Formatting Rules for ALL Users
      const globalStandard = `
        הנחיה גורפת לזמנים - חובה לקרוא לפני כל תשובה:
        היום הוא ${dateStr}. השעה היא ${timeStr}.
        ערכים טכניים מדויקים:
        - ISO-8601: ${isoStr}
        - Unix Epoch: ${epochSeconds}
        - יום בשבוע: ${now.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' })}
        
        כל חישוב של "מחר", "אתמול", או "עוד X זמן" חייב להתבסס אך ורק על הנתונים לעיל. אל תסתמכי על שום ידע קודם לגבי התאריך. אם את קובעת פגישה ל"מחר", התאריך חייב להיות היום שאחרי ה-${now.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' })}.
        
        הנחיות קריטיות לעיצוב וסגנון (תקף לכל השיחות):
        הנחיות קריטיות לעיצוב וסגנון (תקף לכל השיחות):
        - **מלל העסק**: השתמשי תמיד בביטוי "הנציגה הדיגיטלית של איי קיי חברת ניקיון ואחזקה" (לעולם אל תשתמשי במילה "תחזוקה").
        - **יישור לימין**: כל שורה של הודעת הפתיחה או הרשימה חייבת להתחיל בתו ה-RLM הסמוי (\u200F).
        - **טון דיבור**: היי מאוד לבבית, חייכנית ושירותית 😊✨. השתמשי באימוג'ים שמחים (✨, 😊, 🙏, ✅).
        - **הפקת מסמכים**: יש לך אפשרות להפיק מסמכים (חשבונית, קבלה, הצעת מחיר) בעזרת הכלים שלך.
        - **תזכורות**: יש לך אפשרות לתזמן תזכורות (scheduleReminder).
        - **יומן גוגל**: יש לך אפשרות לקבוע פגישות (scheduleCalendarEvent).
      `;

      const openingInstruction = shouldForceOpening ? `
\u200F*שלום רב,*  
\u200Fאני רותם, הנציגה הדיגיטלית של 'איי קיי חברת ניקיון ואחזקה' 🧹. 
\u200Fנשמח לעמוד לשירותכם! ✨
\u200Fבמה אוכל לעזור? אנא בחרו את האופציה המתאימה:
\u200F1️⃣ **לקוח חדש** - לקבלת הצעת מחיר מפתיעה 🏢.
\u200F2️⃣ **לקוח קיים** - לשירות לקוחות ותמיכה טכנית 🛠️.
\u200F3️⃣ **אחר** - לכל נושא או בירור נוסף 💬.

\u200Fאו כתוב לי את בקשתך החופשית! 😊` : '';

      let systemPrompt = '';
      if (isSuperUser) {
        systemPrompt = `את/ה רותם, סוכנת-על דיגיטלית חכמה. המשתמש הנוכחי הוא הבעלים שלך (${senderNumber}).
          ${globalStandard}
          חשוב ביותר: עבור הבעלים, אין לך שום הגבלה על נושאי השיחה.
          הסגנון שלך חייב להיות ענייני, מקצועי ומכובד. ללא מילות חיבה.`;
      } else if (isOfficeOrCommittee) {
          systemPrompt = `את/ה רותם, סוכנת שירות לקוחות רשמית של "איי קיי חברת ניקיון ואחזקה". 
          ${globalStandard}
          המשתמש הזה הוא "משרד" או "ועד בית". עני בצורה עניינית ומקצועית בלבד ובנושאי ניקיון/אחזקה.`;
      } else {
          systemPrompt = `את/ה רותם, סוכנת שירות לקוחות רשמית וחייכנית של "איי קיי חברת ניקיון ואחזקה" ✨. 
          ${globalStandard}
          את מוגבלת אך ורק לתחומי הניקיון, האחזקה ושירות הלקוחות של העסק.`;
      }

      if (isVoiceMessage) {
        systemPrompt += `\n\nחשוב: המשתמש שלח הודעה קולית. עני בטקסט זורם להקראה, ללא עיצובים (כמו \u200F או *).`;
      }

      const context = [
        { role: 'system', content: systemPrompt },
        ...(isAskingForOpening ? [] : history.map((h: any) => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.content,
        })))
      ];

      context.push({
        role: 'system',
        content: `תזכורת סופית: היום ה-${dateStr}, השעה ${timeStr}. ${shouldForceOpening ? `השתמשי בדיוק בפורמט הודעת הפתיחה הבא:\n${openingInstruction}` : 'עני ישירות לבקשת המשתמש.'} ${isAskingForOpening ? 'כעת הצג את הודעת הפתיחה המלאה.' : ''}`
      });

      // Get Agent
      const agent = mastra.getAgent('whatsapp-agent');
      console.log(`Using model: ${agent.model}`);
      
      // Generate response
      const result = await agent.generate(text || 'שלום', {
        context: context as any
      });
      const replyText = result.text;

      console.log(`[${APP_VERSION}] Generated reply: "${replyText}"`);

      // Save assistant message
      await saveMessage(chatId, 'assistant', replyText);

      // Send via Green API (Voice or Text)
      if (isVoiceMessage) {
         try {
           console.log(`[TTS] Generating voice note for reply...`);
           const ttsBuffer = await elevenLabs.textToSpeech(replyText);
           const uploadUrl = await greenApi.uploadFile(ttsBuffer, 'audio/mpeg', 'reply.mp3');
           await greenApi.sendFileByUrl(chatId, uploadUrl, 'reply.mp3');
           console.log('Voice note sent successfully.');
         } catch (e: any) {
           console.error(`[TTS Error] Failed to generate/send voice note (${e.message}). Falling back to text...`);
           await greenApi.sendMessage(chatId, replyText);
         }
      } else {
         await greenApi.sendMessage(chatId, replyText);
         console.log('Text reply sent successfully.');
      }
      
      await greenApi.setChatPresence(chatId, 'paused');


      return NextResponse.json({ 
        status: 'success', 
        reply: replyText,
        debug: {
          isSuperUser,
          senderNumber,
          cleanSender,
          widNumber,
          type
        }
      });
    }

    return NextResponse.json({ status: 'ignored_event' });
  } catch (error: any) {
    console.error('Webhook Error:', error);
    const detail = error.responseBody || error.data || null;
    if (detail) {
      console.error('AI Error Detail:', detail);
    }
    return NextResponse.json({ 
      error: error.message, 
      detail: typeof detail === 'string' ? JSON.parse(detail) : detail 
    }, { status: 500 });
  }
}
