import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/mastra';
import { pdfToPng } from 'pdf-to-png-converter';
import { greenApi } from '@/lib/green-api';
import { saveMessage, getHistory, isBotActive, setBotStatus, isWebhookProcessed } from '@/lib/supabase';
import { elevenLabs } from '@/lib/elevenlabs';
import heicConvert from 'heic-convert';
import { processDueReminders } from '@/lib/reminders';

function assertTrustedDownloadUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid download URL: ${url}`);
  }
  const allowedSuffixes = ['.greenapi.com', '.green-api.com', '.digitaloceanspaces.com'];
  if (!allowedSuffixes.some(suffix => parsed.hostname.endsWith(suffix))) {
    throw new Error(`Untrusted download URL host: ${parsed.hostname}`);
  }
}

export async function POST(req: NextRequest) {
  const APP_VERSION = 'v5.0-PDF_NATIVE';
  console.time(`[${APP_VERSION}] webhook-total`);

  let body: any = {};
  let currentStage = 'init';
  try {
    currentStage = 'parsing_webhook';
    try {
      body = await req.json();
    } catch (e) {
      console.warn('Failed to parse webhook body');
      return NextResponse.json({ status: 'invalid_json' });
    }
    console.log('[WEBHOOK] type:', body.typeWebhook, 'id:', body.idMessage);
    const type = body.typeWebhook;

    const isIncoming = type === 'incomingMessageReceived' || type === 'webhookIncomingMessageReceived';
    const isOutgoing = type === 'outgoingMessageReceived' || type === 'outgoingAPIMessageReceived';

    const idMessage = body.idMessage;
    if (idMessage && (isIncoming || isOutgoing)) {
      if (await isWebhookProcessed(idMessage)) {
        console.log(`[DEDUPLICATION] Skipping already processed webhook: ${idMessage} (Type: ${type})`);
        return NextResponse.json({ status: 'success_deduplicated_by_id' });
      }
    }

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
      
      // Exact match on last 9 significant digits — avoids substring/forgery attacks via chatId
      const SUPER_USER_SUFFIXES = new Set(['526672663']);
      const senderSuffix = rawSenderClean.slice(-9);
      const isSuperUser = senderSuffix.length === 9 && SUPER_USER_SUFFIXES.has(senderSuffix);

      // Known contacts with special roles
      const ACCOUNTANT_SUFFIXES = new Set(['543972690']); // אייל אסרף - רואה חשבון
      const isAccountant = senderSuffix.length === 9 && ACCOUNTANT_SUFFIXES.has(senderSuffix);

      if (chatId.endsWith('@g.us')) {
        console.log(`Ignoring group message from ${chatId}`);
        return NextResponse.json({ status: 'ignored_group' });
      }

      let contactName = '';
      let visionError: string | null = null;
      let fileData: any = null;
      currentStage = 'initialization';
      
      try {
        const contactInfo = await greenApi.getContactInfo(chatId);
        contactName = contactInfo.contactName || '';
      } catch (e) {
        contactName = senderData?.senderName || '';
      }

      const pushName = senderData?.senderName || '';
      // PRIORITY: contactName (from phone contacts) > pushName (WhatsApp profile name set by sender)
      const senderName = contactName || pushName || '';

      // Filters
      const blacklist = ['אמא', 'Mom', 'אוריה חיים שלי', 'אריאלי', 'שלומי ידיד', 'קימי', 'קארין', 'סבינה גננת'];
      const blacklistedNumbers = ['972542619636', '0542619636', '542619636', '998910366781'];
      
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

      // NEW: Ignore non-content types like reactions, polls, etc.
      const ignoredTypes = ['reactionMessage', 'pollMessage', 'pollUpdateMessage', 'editedMessage', 'deletedMessage', 'stickerMessage'];
      if (isIncoming && ignoredTypes.includes(typeMessage)) {
        console.log(`[FILTER] Ignoring non-content message type: ${typeMessage}`);
        return NextResponse.json({ status: `ignored_${typeMessage}` });
      }

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

      currentStage = 'processing_media';

      const isImage = typeMessage === 'imageMessage';
      const isDocument = typeMessage === 'documentMessage';
      const isVideo = typeMessage === 'videoMessage';

      // Non-super users sending media (images, documents, videos): acknowledge without analysis
      if ((isImage || isDocument || isVideo) && !isSuperUser) {
        const mediaLabel = isImage ? 'תמונה' : isDocument ? 'מסמך' : 'וידאו';
        const ackMsg = `\u200Fקיבלתי את ה${mediaLabel}, אני מעבירה את זה להמשך טיפול 🙏`;
        await greenApi.setChatPresence(chatId, 'composing');
        await saveMessage(chatId, 'user', `[${mediaLabel}]`);
        await saveMessage(chatId, 'assistant', ackMsg);
        await greenApi.sendMessage(chatId, ackMsg);
        await greenApi.setChatPresence(chatId, 'paused');
        return NextResponse.json({ status: `${mediaLabel}_acknowledged` });
      }

      if (isVoiceMessage) {
        const downloadUrl = messageData.fileMessageData?.downloadUrl;
        if (downloadUrl) {
           try {
             assertTrustedDownloadUrl(downloadUrl);
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
      } else if (isImage || isDocument || isVideo) {
        const downloadUrl = messageData.fileMessageData?.downloadUrl || 
                            messageData.imageMessageData?.downloadUrl || 
                            messageData.documentMessageData?.downloadUrl ||
                            messageData.videoMessageData?.downloadUrl;
        
        let mimeType = messageData.fileMessageData?.mimeType ||
                         messageData.imageMessageData?.mimeType ||
                         messageData.documentMessageData?.mimeType ||
                         messageData.videoMessageData?.mimeType ||
                         (isImage ? 'image/jpeg' : isVideo ? 'video/mp4' : 'application/pdf');

        let originalPdfBuffer: Buffer | null = null;
        try {
          let fileBuffer: Buffer | null = null;
          if (downloadUrl) {
            assertTrustedDownloadUrl(downloadUrl);
            console.log(`[MEDIA] Downloading ${typeMessage} via URL: ${downloadUrl}`);
            fileBuffer = await greenApi.downloadFile(downloadUrl);
          } else if (idMessage) {
            console.log(`[MEDIA] Downloading ${typeMessage} via MessageId: ${idMessage}`);
            fileBuffer = await greenApi.downloadFileByMessage(chatId, idMessage);
          }

          if (fileBuffer) {
            console.log(`[MEDIA] Downloaded ${fileBuffer.length} bytes. Mime: ${mimeType}`);
            
            // HEIC/HEIF Support
            if (mimeType.includes('heic') || mimeType.includes('heif')) {
              try {
                console.log('[VISION] Converting HEIC to JPG...');
                fileBuffer = Buffer.from(await heicConvert({
                  buffer: fileBuffer.buffer as ArrayBuffer,
                  format: 'JPEG',
                  quality: 0.8
                }));
                mimeType = 'image/jpeg';
                console.log(`[VISION] HEIC converted to ${fileBuffer.length} bytes JPG.`);
              } catch (heicErr: any) {
                console.error(`[HEIC Conversion Error] ${heicErr.message}`);
                throw new Error('אירעה שגיאה בעיבוד תמונה מהאייפון (HEIC). אנא שלח צילום מסך רגיל.');
              }
            }
            
            // PDF Extraction (Hybrid Flow: Text first, then Image)
            if (mimeType === 'application/pdf' && fileBuffer) {
              originalPdfBuffer = fileBuffer;
              try {
                console.log('[VISION] Extracting text from PDF...');
                // @ts-ignore
                const pdfParse = (await import('pdf-parse'));
                const pdfData = await (pdfParse as any)(fileBuffer);
                if (pdfData.text && pdfData.text.trim().length > 50) {
                  const extractedText = pdfData.text.replace(/\n\s*\n/g, '\n').substring(0, 15000);
                  text = `${text || '[מסמך PDF]'}\n\n--- תוכן טקסטואלי שחולץ מהמסמך ---\n${extractedText}`;
                  // Mark as processed text-wise, might still try image thumbnail for context
                  console.log(`[VISION] PDF text extracted: ${extractedText.length} chars.`);
                }
              } catch (pdfParseErr: any) {
                console.error(`[PDF Parse Error] ${pdfParseErr.message}`);
              }

              // Try PDF to Image conversion as a fallback/visual context
              try {
                console.log('[VISION] Converting PDF to image for visual analysis...');
                const pngPages = await pdfToPng(fileBuffer as any, { 
                  pagesToProcess: Array.from({length: 3}, (_, i) => i + 1), // Limit to 3 for speed when text is available
                  viewportScale: 1.5 // Lower scale for context
                });
                if (pngPages.length > 0 && pngPages[0].content) {
                  fileBuffer = Buffer.from(pngPages[0].content);
                  mimeType = 'image/png';
                  console.log(`[VISION] PDF converted to image context.`);
                }
              } catch (pdfErr: any) {
                console.warn(`[PDF Image Fallback Failed] ${pdfErr.message}`);
                // If text exists, we don't care about image conversion failing
              }
            }

            // Vision processing for images and documents
            const SUPPORTED_VISION_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
            const isSupportedImage = SUPPORTED_VISION_MIMES.includes(mimeType);
            const thumbnail = isImage ? messageData.imageMessageData?.jpegThumbnail : messageData.documentMessageData?.jpegThumbnail;

            if ((isImage || isDocument) && fileBuffer) {
              const MAX_SIZE = 5 * 1024 * 1024; // 5MB limit
              const useThumbnail = !isSupportedImage || fileBuffer.length > MAX_SIZE;

              if (useThumbnail && thumbnail) {
                 console.log(`[VISION] Using thumbnail for ${mimeType}`);
                 // IMPORTANT: Use raw base64 WITHOUT the prefix for the 'image' field
                 const cleanThumbnail = thumbnail.replace(/^data:image\/[a-z]+;base64,/, '').replace(/\s/g, '');
                 
                 fileData = { 
                   type: 'image', 
                   image: `data:image/jpeg;base64,${cleanThumbnail}`,
                   mimeType: 'image/jpeg'
                 } as any;
                 
                 if (isDocument && mimeType === 'application/pdf') {
                   text = `${text || '[מסמך PDF]'} (שים לב: צירפתי תצוגה מקדימה של העמוד הראשון מהמסמך הדיגיטלי)`;
                 }
              } else if (isSupportedImage) {
                console.log(`[VISION] Sending full image (Mime: ${mimeType}).`);
                const base64 = fileBuffer.toString('base64');
                fileData = { 
                   type: 'image', 
                   image: `data:${mimeType};base64,${base64}`,
                   mimeType: mimeType
                } as any;
              } else if (text && text.length > 10) {
                // If we have any extracted text (even short), proceed with text-only analysis
                console.log('[VISION] Proceeding with extracted text only (no image available).');
              } else if (originalPdfBuffer) {
                // Scanned PDF with no text layer and no thumbnail — send raw PDF to GPT-4.1 which supports it natively
                console.log('[VISION] Falling back to GPT-4.1 native PDF processing (scanned document).');
                fileData = { type: 'pdf_native', pdfBase64: originalPdfBuffer.toString('base64') } as any;
              } else {
                // No image, no thumbnail, no text, no PDF buffer — truly can't process
                const formatName = mimeType.split('/')[1]?.toUpperCase() || 'לא מוכר';
                throw new Error(`פורמט ${formatName} דורש המרה לתמונה (JPG) או שהוא מסמך סרוק ללא טקסט. אנא שלח צילום מסך רגיל.`);
              }
            }
            
            if (!text) {
              text = `[${isImage ? 'תמונה' : isDocument ? 'מסמך' : 'וידאו'} שצורף]`;
            }
          }
        } catch (e: any) {
          console.error(`[Media Download Error] ${e.message}`);
          visionError = `שגיאת הורדה: ${e.message}`;
          if (!text) text = `[משתמש שלח ${typeMessage}, אך חלה שגיאה טכנית בהורדה]`;
        }
      }

      await greenApi.setChatPresence(chatId, isVoiceMessage ? 'recording' : 'composing');
      const placeholder = isVoiceMessage ? '[הודעה קולית]' : '[קובץ/תמונה]';
      
      // CRITICAL: If no text and no media data, this is likely an empty event or unsupported type.
      // Do not fallback to 'שלום' as it triggers unnecessary AI cycles.
      if (!text && !isVoiceMessage && !isImage && !isDocument && !isVideo) {
        console.log('[FILTER] No actionable text or media found. Skipping agent processing.');
        return NextResponse.json({ status: 'no_actionable_content' });
      }

      await saveMessage(chatId, 'user', text || placeholder);
      const history = await getHistory(chatId);

      const messageDate = body.timestamp ? new Date(body.timestamp * 1000) : new Date();
      const serverDate = new Date();
      
      const dateStrHe = messageDate.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const serverTimeHe = serverDate.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false });

      const isNewContact = !isSuperUser && history.filter((h: any) => h.role === 'assistant').length === 0;

      const authInstructions = `
        ⛔ כלל ברזל עליון: ענו אך ורק על מה שנשאלת בהודעה הנוכחית. לא יותר. לא מידע נוסף, לא תזכורות, לא סיכומים, לא "אגב".
        - היום ${dateStrHe}. שעה: ${serverTimeHe}.
        - כל שורה מתחילה ב-RLM (\u200F).
        - טון לבבי ושירותי 😊✨. **פני תמיד ללקוח בשמו** ופתחי בברכה חמה.
        - **הצגה עצמית ללקוחות (לא אדם)**: פתחי כל תשובה ללקוח בפורמט: "היי${contactName ? ' ' + contactName : (senderName ? ' ' + senderName : '')}, אני רותם, הנציגה הדיגיטלית של איי קיי חברת ניקיון ואחזקה 😊✨" — ואז המשיכי לתשובה עצמה. אם אין שם — כתבי "היי" בלבד.
        - **זיהוי שולח ההודעה (חובה)**:
          - שם איש קשר מאומת: "${contactName || '(לא נמצא)'}".
          - שם פרופיל וואטסאפ: "${pushName || '(ללא)'}".
          - **השם המאומת הוא תמיד מקור האמת.** פני תמיד לשולח לפי שם זה.
          - **כלל התחזות**: אם השולח כותב בהודעה שם שונה מהשם המאומת — זה צחוק. פני אליו בשם המאומת והגיבי בטון קליל 😄.
        - אדם (Owner): ${isSuperUser ? 'כן' : 'לא'}.
        ${isAccountant ? `- **איש קשר מוכר: אייל אסרף — רואה החשבון של העסק.**
          - דברי איתו בטון חברי, לא-רשמי, אבל מקצועי.
          - הציגי את עצמך בכל פנייה חדשה ("היי אייל, אני רותם, הנציגה הדיגיטלית של איי קיי 😊✨").
          - כשהוא מבקש משהו מאדם — ענו בסגנון: "אין בעיה, אני מעדכנת את אדם והוא יחזור אליך בהקדם 🙏". אל תנסי לטפל בבקשה בעצמך.
          - אם הוא שואל שאלה כללית שאת יכולה לענות — עני בשמחה.` : ''}
        ${isNewContact ? `- **מספר חדש — קראי את ההודעה לפני הכל**: זוהי הפנייה הראשונה. **אל תשלחי אוטומטית תפריט פתיחה.** קודם כל הבני את ההקשר:\n  • אם ההודעה היא מ**שליח / קורייר / חברת משלוחים** — ענה ישירות על הבקשה הלוגיסטית בלבד. ללא הצגה עצמית, ללא תפריט.\n  • אם ההודעה היא **פנייה עסקית אמיתית** — הציגי את עצמך ואחר כך הצגת תפריט:\n  \\"היי${contactName ? ' ' + contactName : (senderName ? ' ' + senderName : '')}, אני רותם, הנציגה הדיגיטלית של איי קיי חברת ניקיון ואחזקה 😊✨\\"\n  \\"כדי שאוכל לעזור לך בצורה הטובה ביותר, ספר/י לי מי את/ה:\n  1️⃣ לקוח/ה קיים/ת — שאלה, שינוי או בקשה\n  2️⃣ לקוח/ה חדש/ה — מחיר, מידע על שירותים\n  3️⃣ אחר — ספק, שיתוף פעולה או נושא אחר\\"\n  • בכל מקרה אחר — ענה בטבעיות בלי תפריט.` : ''}
      `;

      const agent = mastra.getAgent('whatsapp-agent');
      currentStage = 'agent_generation';

      // HISTORY CONSTRUCTION — ARCHITECTURAL FIX:
      // The model CANNOT reliably ignore history even with explicit instructions.
      // Solution: Don't send history unless it's genuinely needed for the current exchange.
      
      const now = new Date();
      let historyForPrompt: any[] = [];

      if (isSuperUser) {
        // OWNER (Adam): Each message is independent. Only include history if there's
        // an active rapid-fire conversation (last message within 2 minutes).
        const lastMsg = history.filter((h: any) => h.created_at).pop();
        const lastMsgAge = lastMsg ? (now.getTime() - new Date(lastMsg.created_at).getTime()) : Infinity;
        const isActiveConversation = lastMsgAge < 2 * 60 * 1000; // 2 minutes
        
        if (isActiveConversation) {
          // Only include the LAST user message (no assistant responses — those contain tool output/calendar links)
          const lastUserMsg = history.filter((h: any) => {
            if (h.role !== 'user') return false;
            const content = (h.content || '').toLowerCase();
            // Skip the message we just saved
            if (content === (text || '').toLowerCase()) return false;
            return true;
          }).pop();
          if (lastUserMsg) {
            historyForPrompt = [{ role: 'user', content: lastUserMsg.content }];
          }
        }
        // If not active conversation → historyForPrompt stays empty → clean slate
      } else {
        // CLIENTS: Include recent, clean history for conversational context (menu flow, etc.)
        historyForPrompt = history
          .filter((h: any) => {
            const content = (h.content || '').toLowerCase();
            
            // Filter out tool outputs and noisy messages that cause bleed
            const isNoisy = 
                   content.includes('[אבחון טכני:') || 
                   content.includes('_vbuild_') ||
                   content.includes('_build_') ||
                   content.includes('שמחה לעזור לך עם כל הבקשות') ||
                   content.includes('סיכום של השיחה') ||
                   content.includes('לינק יוסיף בהמשך') ||
                   content.includes('google.com/calendar') ||
                   content.includes('הוסף ליומן') ||
                   content.includes('scheduleCalendarEvent') ||
                   content.includes('scheduleReminder') ||
                   (content.includes('פגישה') && content.includes('לינק'));

            if (isNoisy) return false;

            // Skip the message we just saved
            if (content === (text || '').toLowerCase() || content === (placeholder || '').toLowerCase()) return false;

            // Only include messages from the last 10 minutes
            if (h.created_at) {
              const msgAge = now.getTime() - new Date(h.created_at).getTime();
              if (msgAge > 10 * 60 * 1000) return false;
            }

            return true;
          })
          .slice(-2); // Max 2 messages for context
      }
      
      const promptContentParts: any[] = [];
      
      if (fileData) {
        promptContentParts.push(fileData);
      }

      promptContentParts.push({ type: 'text', text: text || 'שלום' });

      // Build messages — no history bleed possible when historyForPrompt is empty
      const messages: any[] = [
        { role: 'system', content: authInstructions },
        ...historyForPrompt.map((h: any) => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.content,
        })),
        { role: 'user', content: promptContentParts }
      ];

      const lastAssistantMessage = history.filter((h: any) => h.role === 'assistant').pop();
      if (lastAssistantMessage && (new Date().getTime() - new Date(lastAssistantMessage.created_at).getTime() < 10000)) {
           return NextResponse.json({ status: 'success_deduplicated' });
      }

      let result: any;
      try {
        if (fileData?.type === 'pdf_native') {
          // GPT-4.1 native PDF support — handles scanned PDFs without image conversion
          console.log('[VISION] Using GPT-4.1 native PDF processing.');
          const pdfSystemPrompt = `אתה מנתח מסמכים אובייקטיבי. ענה תמיד בעברית.
1. זהה את סוג המסמך (ביטוח, חשבונית, קבלה, דוח דלק וכו') לפי התוכן בלבד.
2. חלץ את כל נקודות המידע: שמות, תאריכים, מספרים, סכומים, פריטים.
3. הצג סיכום ברור ומסודר.
4. לאחר הסיכום, ענה בתור "רותם", הנציגה הדיגיטלית של "איי קיי חברת ניקיון ואחזקה" 🧹.
5. כל שורה מתחילה ב-RLM (\u200F). טון מקצועי ושירותי 😊✨`;

          // OpenAI Responses API (/v1/responses) — supports PDF natively via input_file
          const pdfOpenAiResponse = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
              model: 'gpt-4.1',
              input: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'input_file',
                      filename: 'document.pdf',
                      file_data: `data:application/pdf;base64,${fileData.pdfBase64}`
                    },
                    {
                      type: 'input_text',
                      text: `${pdfSystemPrompt}\n\nשאלה/הוראה: ${text || 'אנא סכם את המסמך הזה בעברית.'}`
                    }
                  ]
                }
              ]
            })
          });

          const pdfResultJson = await pdfOpenAiResponse.json();
          if (!pdfOpenAiResponse.ok) {
            throw new Error(`GPT-4.1 Responses API PDF failed (${pdfOpenAiResponse.status}): ${JSON.stringify(pdfResultJson).substring(0, 300)}`);
          }
          // Responses API format: { output: [{ type: "message", content: [{ type: "output_text", text: "..." }] }] }
          const pdfSummary = pdfResultJson.output?.[0]?.content?.[0]?.text || 'לא ניתן לסכם את המסמך.';
          visionError = null;
          result = { text: pdfSummary };

        } else if (fileData) {
          const visionSystemPrompt = `Objective Document Analyst Mode:
1. Identify the document type (Car Insurance, ID, Invoice, etc.) based ONLY on the visual content.
2. Extract key data points objectively (Names, Dates, Policy Numbers, Totals).
3. DO NOT assume the document is related to the cleaning business or "איי קיי" unless explicitly mentioned in the text.
4. If it's a Car Insurance document, focus on vehicle details, roadside assistance, and replacement car coverage.
5. After the objective summary, provide a user-friendly response as 'Rotem' (the digital representative of 'איי קיי חברת ניקיון ואחזקה' 🧹), but ensure the facts remain 100% accurate to the image.
6. Tone: Professional, service-oriented. Start each line with the hidden RLM (\u200F). 😊✨`;
          const mergedText = `${visionSystemPrompt}\n\nUser Question/Instruction: ${text || 'Summarize this document accurately.'}`;

          // GPT-4.1 Vision via OpenAI API
          const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
             method: 'POST',
             headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
             },
             body: JSON.stringify({
                model: 'gpt-4.1',
                stream: false,
                messages: [
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: mergedText },
                      { 
                        type: 'image_url', 
                        image_url: { 
                          url: fileData.image,
                          detail: 'high'
                        } 
                      }
                    ]
                  }
                ]
             })
          });

          const resultJson = await openaiResponse.json();

          if (!openaiResponse.ok) {
            throw new Error(`OpenAI Vision failed (${openaiResponse.status}): ${JSON.stringify(resultJson).substring(0, 500)}`);
          }

          const summary = resultJson.choices?.[0]?.message?.content || 'No summary generated.';
          visionError = null; // Success - no error
          result = { text: summary };
        } else {
          // INCREASE STEPS: 8 steps allow for multiple tool calls in one go
          result = await agent.generate(messages, { maxSteps: 8 });
        }
      } catch (e: any) {
        console.error(`[Vision AI Error/SDK] Error: ${e.message}`, e);
        if (fileData) {
          let errorDetail = e.message;
          // Capture deep server response if available (400 validation error body)
          if (e.response?.data) {
             errorDetail = `${e.message} ServerResponse: ${JSON.stringify(e.response.data).substring(0, 500)}`;
          } else if (e.cause) {
             errorDetail = `${e.message} Cause: ${e.cause}`;
          }

          const imgHead = (typeof fileData.image === 'string') ? fileData.image.substring(0, 30) : 'Binary';
          const imgInfo = (typeof fileData.image === 'string') ? `DataURL(${fileData.image.length}) Head: ${imgHead}` : `Buf`;
          visionError = `${errorDetail} (Mime: ${fileData.mimeType || 'unknown'}, Img: ${imgInfo}, Chat: ${chatId}, Owner: ${isSuperUser})`;
          const textOnlyMessages = messages.map((m: any) => {
             if (m.role === 'user' && Array.isArray(m.content)) {
                return { ...m, content: (m.content as any[]).filter(p => p.type === 'text').map(p => p.text).join('\n') };
             }
             return m;
          });
          
          result = await agent.generate(textOnlyMessages, {
            maxSteps: 3,
            instructions: authInstructions + '\n\nשימי לב קריטי: חלה תקלה טכנית בניתוח המסמך/התמונה (אולי הקובץ כבד מדי או בפורמט לא מוכר). אל תנסי לנחש מה יש בו. פשוט הסבירי ברגישות ובטון האישי שלך (בתור רותם) שאת מתקשה כרגע לקרוא את הקובץ הספציפי הזה, והציעי לשלוח שוב כצילום מסך רגיל או להמתין לבדיקה של אדם. ✨'
          });
        } else {
          throw e;
        }
      }
      console.timeEnd(`[${APP_VERSION}] agent-generate`);

      currentStage = 'sending_response';
      let replyText = result.text || 'סליחה, נתקלתי בבעיה קטנה.';
      
      if (isSuperUser) {
        if (visionError) {
          replyText += `\n\n[אבחון טכני: ${visionError}]`;
        }
        const BUILD_ID = 'BUILD_08.05.26_RESPONSES_API_PDF';
        replyText += `\n\n_v${BUILD_ID}_`;
      }

      if (replyText.includes('[IGNORE]')) {
        await saveMessage(chatId, 'assistant', '[בוט התעלם - ברכת חג]');
        return NextResponse.json({ status: 'ignored_by_agent_policy' });
      }

      // CRITICAL: If vision failed, DO NOT guess. Stop here and return error.
      if (visionError) {
         const finalErrorStr = isSuperUser
           ? `\u200Fסליחה אדם, חלה תקלה טכנית בקריאת הקובץ:\n\n[אבחון טכני: ${visionError}]\n\nאנא נסה לשלוח שוב כצילום מסך (JPG).`
           : `\u200Fסליחה, לא הצלחתי לפתוח את הקובץ שצירפת 🙏\n\u200Fאנא שלחי אותו שוב כצילום מסך רגיל (JPG) ואשמח לעזור 😊`;
         await saveMessage(chatId, 'assistant', finalErrorStr);
         await greenApi.sendMessage(chatId, finalErrorStr);
         return NextResponse.json({ status: 'vision_error_hard_stop' });
      }

      await saveMessage(chatId, 'assistant', replyText);

      if (isVoiceMessage) {
         try {
           await greenApi.sendMessage(chatId, replyText);
           let ttsText = replyText.replace(/https?:\/\/[^\s]+/g, '').trim();
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

      // Trigger a check for due reminders on every interaction (workaround for Hobby cron limits)
      processDueReminders().catch(err => console.error('[REMINDER_TRIGGER_ERROR]', err));

      return NextResponse.json({ status: 'success', reply: replyText });
    }

    return NextResponse.json({ status: 'ignored_event' });
  } catch (error: any) {
    console.error('Webhook Error:', error);
    try {
      const chatId = body?.senderData?.chatId || body?.chatId || body?.messageData?.chatId;
      if (chatId) {
        const errorMsg = `\u200F⚠️ *שגיאת מערכת:* (${currentStage})\n\u200Fפירוט: ${error.message}`;
        await greenApi.sendMessage(chatId, errorMsg);
      }
    } catch (e) {}
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
