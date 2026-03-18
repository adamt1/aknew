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
      
      const superUsers = ['972526672663', '972542619636'];
      // Robust super user detection
      const cleanSender = senderNumber.replace(/\D/g, ''); 
      const isSuperUser = superUsers.some(u => cleanSender.includes(u)) || (widNumber && cleanSender.includes(widNumber));

      console.log(`[AUTH_DEBUG] type=${type}, senderNumber="${senderNumber}", cleanSender="${cleanSender}", widNumber="${widNumber}", isSuperUser=${isSuperUser}`);

      // Contact Filter Logic (Only respond to SuperUser, Unsaved Numbers, or Saved contacts with 'משרד'/'ועד בית')
      let contactName = '';
      if (isIncoming && !isSuperUser) {
        try {
          const contactInfo = await greenApi.getContactInfo(chatId);
          contactName = contactInfo.contactName || '';
        } catch (e) {
          console.warn(`Failed to get contact info for ${chatId}, assuming unsaved.`);
        }
      }

      const isSavedContact = contactName.trim().length > 0;
      const isAllowedSavedContact = contactName.includes('משרד') || contactName.includes('ועד בית');

      // We block if it's a saved contact that does not have the allowed keywords.
      if (isIncoming && !isSuperUser && isSavedContact && !isAllowedSavedContact) {
         console.log(`[FILTER] Ignoring message from saved contact ${contactName} (${chatId}) because they don't have 'משרד' or 'ועד בית'.`);
         return NextResponse.json({ status: 'ignored_unauthorized_saved_contact' });
      }

      // Explicit block for specific names (Family, Friends, etc.)
      const pushName = senderData?.senderName || '';
      const blacklist = ['קארין', 'Karin', 'אמא', 'Mom', 'אוריה חיים שלי', 'אריאלי', 'שלומי ידיד', 'קימי'];
      const isExplicitIgnored = blacklist.some(name => pushName.includes(name));
      
      if (isIncoming && !isSuperUser && isExplicitIgnored) {
        console.log(`[FILTER] Ignoring explicitly blocked name "${pushName}" (${chatId}).`);
        return NextResponse.json({ status: 'ignored_explicit_contact' });
      }

      // Loop Prevention: Ignore if sender IS the bot itself (wid) UNLESS it's the owner (super user)
      const isSelfMessage = senderData?.sender === wid;
      if (isIncoming && isSelfMessage && !isSuperUser) {
        console.log(`Ignoring loop message from self: ${wid}`);
        return NextResponse.json({ status: 'ignored_self_loop' });
      }

      // Ignore group chats
      if (chatId.endsWith('@g.us')) {
        console.log(`Ignoring group message from ${chatId}`);
        return NextResponse.json({ status: 'ignored_group' });
      }

      // Handle message content
      let text = messageData.textMessageData?.textMessage || 
                   messageData.extendedTextMessageData?.text ||
                   messageData.quotedMessage?.text;

      const typeMessage = messageData.typeMessage;
      const isVoiceMessage = typeMessage === 'audioMessage';

      // Prevention Loop: Don't respond to messages sent by the API itself (the bot's own replies)
      if (type === 'outgoingAPIMessageReceived') {
        console.log('Ignoring message sent via API to prevent loop.');
        return NextResponse.json({ status: 'ignored_api_outgoing' });
      }

      // Human Intervention Logic: If owner sends a message to a user, disable the bot for that thread
      if (isOutgoing && (isSuperUser || type === 'outgoingMessageReceived')) {
        // Only disable if messaging someone else (not testing with self or the bot itself)
        if (chatId !== rawSender && (!wid || !chatId.includes(widNumber))) {
          console.log(`[HUMAN_INTERVENTION] Owner ${senderNumber} messaged ${chatId}. Disabling bot.`);
          await setBotStatus(chatId, false);
          return NextResponse.json({ status: 'bot_disabled_by_owner' });
        }
        console.log(`[HUMAN_INTERVENTION_SKIP] Owner is messaging self or bot instance. No override.`);
      }

      // Emoji-Only Intervention: If customer sends only emojis, it triggers human intervention
      const isEmojiOnly = text && /^(\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}|\p{Emoji_Component}|\s)+$/u.test(text);
      if (isIncoming && isEmojiOnly) {
        console.log(`[EMOJI_INTERVENTION] Customer sent emoji-only message. Disabling bot for ${chatId}.`);
        await setBotStatus(chatId, false);
        return NextResponse.json({ status: 'bot_disabled_by_emoji' });
      }

      // Voice message transcription
      if (isVoiceMessage) {
        const downloadUrl = messageData.fileMessageData?.downloadUrl;
        if (downloadUrl) {
           console.log(`[STT] Downloading voice message from ${downloadUrl}`);
           try {
             const audioBuffer = await greenApi.downloadFile(downloadUrl);
             text = await elevenLabs.speechToText(audioBuffer);
             console.log(`[STT] Transcribed: "${text}"`);
           } catch (e: any) {
             console.error(`[STT Error] Failed to transcribe: ${e.message}`);
             if (isSuperUser) {
               await greenApi.sendMessage(chatId, `❌ [Debug STT Error] ${e.message}`);
             }
             return NextResponse.json({ status: 'stt_failed' });
           }
        }
      }

      console.log(`Processing message from ${chatId} (Super: ${isSuperUser}, Type: ${typeMessage}): "${text}"`);

      if (!text && !isSuperUser && !isVoiceMessage) {
        console.log('No text content for regular user, ignoring.');
        return NextResponse.json({ status: 'no_text' });
      }

      if (!text && isSuperUser && !isVoiceMessage) {
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
      await greenApi.setChatPresence(chatId, isVoiceMessage ? 'recording' : 'composing');

      // Save user message (including transcribed text)
      await saveMessage(chatId, 'user', text || '[Voice Message]');

      // Fetch history
      const history = await getHistory(chatId);
      // Contact classification
      const isOfficeOrCommittee = contactName.includes('משרד') || contactName.includes('ועד בית');

      // Use message timestamp for better accuracy, fallback to server time
      const now = body.timestamp ? new Date(body.timestamp * 1000) : new Date();
      console.log(`[TIME_DEBUG] Server: ${new Date().toISOString()}, Message: ${now.toISOString()}, GreenTimestamp: ${body.timestamp}`);
      
      // Ensure we use Israel TimeZone specifically, otherwise Vercel defaults to UTC
      const dateStr = now.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
      
      // Force Loop Break: If the user asks for the opening message, we ignore history to prevent copy-pasting the old format
      const isAskingForOpening = text?.includes('הודעת פתיחה') || text?.includes('הודעת הפתיחה');

      const localIsoDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      const localIsoTime = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem' });
      const tzOffsetMatch = now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' }).match(/GMT([+-]\d+)/);
      const offsetHours = tzOffsetMatch ? tzOffsetMatch[1] : '+02';
      const offsetStr = `${offsetHours.length === 2 ? offsetHours.charAt(0) + '0' + offsetHours.charAt(1) : offsetHours}:00`;
      const localIsoStr = `${localIsoDate}T${localIsoTime}${offsetStr}`;

      // Standard Formatting Rules for ALL Users
      const globalStandard = `
        הנחיה גורפת לזמנים - חובה לקרוא לפני כל תשובה:
        היום הוא ${dateStr}. השעה היא ${timeStr}.
        ערכים טכניים מדויקים המייצגים את הזמן המקומי בישראל:
        - ISO-8601 (Local Time): ${localIsoStr}
        - יום בשבוע: ${now.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long' })}
        
        כל חישוב של "מחר", "אתמול", או "עוד X זמן" חייב להתבסס אך ורק על הנתונים לעיל. אל תסתמכי על שום ידע קודם לגבי התאריך. אם את קובעת פגישה ל"מחר", התאריך חייב להיות היום שאחרי ה-${now.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' })}.
        
        הנחיות קריטיות לעיצוב וסגנון (תקף לכל השיחות):
        - **מלל העסק**: השתמשי תמיד בביטוי "הנציגה הדיגיטלית של איי קיי חברת ניקיון ואחזקה" (לעולם אל תשתמשי במילה "תחזוקה").
        - **יישור לימין**: כל שורה של הודעת הפתיחה או הרשימה חייבת להתחיל בתו ה-RLM הסמוי (\u200F).
        - **טון דיבור**: היי מאוד לבבית, חייכנית ושירותית 😊✨. השתמשי באימוג'ים שמחים (✨, 😊, 🙏, ✅).
        - **הפקת מסמכים**: יש לך אפשרות להפיק מסמכים (חשבונית, קבלה, הצעת מחיר) דרך המערכת בעזרת הכלים שלך. לפני הפקת מסמך, תמיד ודאי שכל הפרטים קיימים: שם לקוח, סוג מסמך, תיאור שירות, כמות, ומחיר ליחידה.
        - **תזכורות**: יש לך אפשרות לתזמן תזכורות באמצעות הכלי scheduleReminder. כאשר הלקוח מבקש תזכורת (למשל: "תזכירי לי בעוד שעה..."), חשבי את הזמן המדויק לפי השעה הנוכחית וצרי את התזכורת. לאחר יצירתה, תמיד אשרי ללקוח שהתזכורת נקבעה לשעה המדויקת.
        - **יומן גוגל (Calendar)**: יש לך אפשרות לקבוע פגישות ביומן גוגל באמצעות הכלי scheduleCalendarEvent. ודאי שיש לך את כותרת הפגישה, התאריך והשעה. אם לא צוין זמן סיום, הניחי שהפגישה נמשכת שעה אחת. אשרי ללקוח לאחר קביעת הפגישה וספקי לו את פרטי הזמן.
      `;

      const openingTemplate = `
        \u200F*שלום רב,*  
        \u200Fאני רותם, הנציגה הדיגיטלית של 'איי קיי חברת ניקיון ואחזקה' 🧹. 
        \u200Fנשמח לעמוד לשירותכם! ✨
        \u200Fבמה אוכל לעזור? אנא בחרו את האופציה המתאימה:
        \u200F1️⃣ **לקוח חדש** - לקבלת הצעת מחיר מפתיעה 🏢.
        \u200F2️⃣ **לקוח קיים** - לשירות לקוחות ותמיכה טכנית 🛠️.
        \u200F3️⃣ **אחר** - לכל נושא או בירור נוסף 💬.
        
        \u200Fאו כתוב לי את בקשתך החופשית! 😊
      `;

      let systemPrompt = '';

      if (isSuperUser) {
        systemPrompt = `את/ה רותם, סוכנת-על דיגיטלית חכמה. המשתמש הנוכחי הוא הבעלים שלך (${senderNumber}).
          ${globalStandard}
          חשוב ביותר: עבור הבעלים, אין לך שום הגבלה על נושאי השיחה.
          הסגנון שלך חייב להיות ענייני, מקצועי ומכובד. ללא מילות חיבה.`;
          
        if (isAskingForOpening) {
          systemPrompt += `\nהבעלים ביקש לראות את הודעת הפתיחה. הצג לו אותה בדיוק לפי הפורמט הבא:\n${openingTemplate}`;
        }
      } else if (isOfficeOrCommittee) {
          systemPrompt = `את/ה רותם, סוכנת שירות לקוחות רשמית של "איי קיי חברת ניקיון ואחזקה". 
          ${globalStandard}
          המשתמש הזה הוא "משרד" או "ועד בית". עני בצורה עניינית ומקצועית בלבד ובנושאי ניקיון/אחזקה.`;
      } else {
          systemPrompt = `את/ה רותם, סוכנת שירות לקוחות רשמית וחייכנית של "איי קיי חברת ניקיון ואחזקה" ✨. 
          ${globalStandard}
          את מוגבלת אך ורק לתחומי הניקיון, האחזקה ושירות הלקוחות של העסק.`;
      }

      // Add instruction for voice message context
      if (isVoiceMessage) {
        systemPrompt += `\n\nהערה חשובה: המשתמש שלח לך הודעה קולית שאותה תמללנו. הקפידי לענות לו בצורה טבעית וזורמת שמתאימה לשיחה הקולית, בלי לכלול עיצובים מוזרים שנועדו רק לקריאה (כמו \u200F או הדגשות כוכביות).`;
      }

      // Form context
      const context = [
        { role: 'system', content: systemPrompt },
        ...(isAskingForOpening ? [] : history.map((h: any) => ({
          role: h.role,
          content: h.content,
        })))
      ];

      // Add a final, non-negotiable instruction to ensure the formatting and rules are followed
      const shouldForceOpening = isAskingForOpening || (!isSuperUser && history.length <= 1);
      context.push({
        role: 'system',
        content: `תזכורת סופית: היום ה-${dateStr}, השעה ${timeStr}. ${shouldForceOpening ? `השתמשי בדיוק בטקסט של הודעת הפתיחה שצוין לעיל:\n${openingTemplate}` : 'עני ישירות לבקשת המשתמש. אם המשתמש מבקש פעולה (כמו קביעת פגישה), השתמשי בכלים שלך.'}`
      });

      // Get Agent
      const agent = mastra.getAgent('whatsapp-agent');
      console.log(`Using model: ${agent.model}`);
      
      // Generate response
      const result = await agent.generate(context);
      const replyText = result.text;

      console.log(`[${APP_VERSION}] Generated reply: "${replyText}"`);

      // Save assistant message
      await saveMessage(chatId, 'assistant', replyText);

      // SHARP HUMAN INTERVENTION CHECK: The AI generation and TTS take time. 
      // If the owner replied manually *while* we were generating this, we must abort sending!
      const finalActiveCheck = await isBotActive(chatId);
      if (!finalActiveCheck) {
        console.log(`[HUMAN_INTERVENTION_ABORT] Bot became inactive for ${chatId} during generation. Aborting message send.`);
        return NextResponse.json({ status: 'aborted_due_to_human_intervention' });
      }

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
