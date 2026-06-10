import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/mastra';

import { greenApi } from '@/lib/green-api';
import { saveMessage, getHistory, isBotActive, setBotStatus, isWebhookProcessed } from '@/lib/supabase';
import { elevenLabs } from '@/lib/elevenlabs';
import heicConvert from 'heic-convert';
import { processDueReminders } from '@/lib/reminders';

function isRateLimitError(e: any): boolean {
  const msg = (e?.message || '').toLowerCase();
  const status = e?.status || e?.statusCode || e?.response?.status;
  return status === 429 || msg.includes('too many requests') || msg.includes('rate limit') || msg.includes('ratelimit');
}

async function agentGenerateWithRetry(
  agent: any,
  messages: any[],
  options: any,
  maxRetries = 3
): Promise<any> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await agent.generate(messages, options);
    } catch (e: any) {
      lastError = e;
      if (isRateLimitError(e) && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000); // 1s, 2s, 4s max 8s
        console.warn(`[RATE_LIMIT] Attempt ${attempt + 1}/${maxRetries + 1} failed. Retrying in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

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

/**
 * Validates that extracted text is actually readable and not garbled.
 * Hebrew PDFs often extract as garbage Unicode due to broken font mapping.
 * The garbled chars typically fall in Arabic Extended-A (U+08xx) and control char ranges.
 * Returns true only if text has enough recognizable chars AND no significant junk.
 */
function isReadableText(text: string): boolean {
  if (!text || text.trim().length < 10) return false;
  
  const cleaned = text.replace(/[\s\t\n\r]+/g, '');
  if (cleaned.length === 0) return false;
  
  let recognizable = 0;
  let junkChars = 0;
  for (const char of cleaned) {
    const code = char.codePointAt(0)!;
    if (
      (code >= 0x0590 && code <= 0x05FF) || // Hebrew
      (code >= 0x0600 && code <= 0x06FF) || // Arabic
      (code >= 0x0020 && code <= 0x007F) || // Basic Latin (ASCII)
      (code >= 0x00A0 && code <= 0x024F)    // Latin Extended
    ) {
      recognizable++;
    }
    // Detect garbled font-mapping chars: Arabic Extended-A (U+08A0-U+08FF),
    // Samaritan, Mandaic, and control chars (U+0000-U+001F)
    if (
      (code >= 0x0800 && code <= 0x08FF) || // Samaritan, Mandaic, Arabic Ext-A
      (code >= 0x0000 && code <= 0x001F && code !== 0x000A && code !== 0x000D) // Control chars (except newline)
    ) {
      junkChars++;
    }
  }
  
  const recognizableRatio = recognizable / cleaned.length;
  const junkRatio = junkChars / cleaned.length;
  // Text is readable if: high recognizable ratio AND low junk ratio
  const isReadable = recognizableRatio >= 0.5 && junkRatio < 0.05;
  console.log(`[PDF_QUALITY] Recognizable: ${(recognizableRatio * 100).toFixed(1)}% (${recognizable}/${cleaned.length}), Junk: ${(junkRatio * 100).toFixed(1)}% (${junkChars}). Readable: ${isReadable}`);
  return isReadable;
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


    // STALE MESSAGE FILTER: Ignore messages older than 3 minutes to prevent
    // replying to old queued messages after Green API subscription renewal
    const messageTimestamp = body.timestamp;
    if (messageTimestamp && (isIncoming || isOutgoing)) {
      const nowUnix = Math.floor(Date.now() / 1000);
      const ageSeconds = nowUnix - messageTimestamp;
      const MAX_AGE_SECONDS = 180; // 3 minutes
      if (ageSeconds > MAX_AGE_SECONDS) {
        console.log(`[STALE_FILTER] Ignoring stale message (age: ${ageSeconds}s, max: ${MAX_AGE_SECONDS}s). ID: ${idMessage}, Type: ${type}`);
        return NextResponse.json({ status: 'ignored_stale_message', ageSeconds });
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
      const blacklist = ['אמא', 'Mom', 'אוריה חיים שלי', 'אריאלי', 'שלומי ידיד', 'קימי', 'קארין', 'סבינה גננת', 'ירון שרעבי', 'חברה שחלו', 'שחלו עובדת', 'זהבה', 'פיני', 'אדיר', 'רז', 'חיים בל'];
      const blacklistedNumbers = ['972546349803', '0546349803', '546349803', '972542619636', '0542619636', '542619636', '998910366781', '972536553345', '536553345'];
      
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
            
            // PDF Processing — with text quality validation and multi-layer fallback
            let pdfTextExtracted = false;
            if (mimeType === 'application/pdf' && fileBuffer) {
              originalPdfBuffer = fileBuffer;
              
              // Step 1: Try text extraction
              try {
                console.log('[PDF] Extracting text from PDF...');
                const { PDFParse } = await import('pdf-parse');
                const parser = new PDFParse({ data: fileBuffer });
                const pdfData = await parser.getText();
                const rawText = pdfData.text || '';
                
                // CRITICAL: Validate text quality — Hebrew PDFs often extract as garbled Unicode
                if (rawText.trim().length > 10 && isReadableText(rawText)) {
                  text = `${text || '[מסמך PDF]'}\n\n--- תוכן שחולץ מהמסמך ---\n${rawText.substring(0, 12000)}`;
                  pdfTextExtracted = true;
                  console.log(`[PDF] Text extracted and validated: ${rawText.trim().length} chars.`);
                } else if (rawText.trim().length > 10) {
                  console.warn(`[PDF] Text extracted (${rawText.trim().length} chars) but FAILED quality check — garbled text detected. Falling back to Vision.`);
                } else {
                  console.warn(`[PDF] Text extraction returned insufficient text (${rawText.trim().length} chars).`);
                }
                await parser.destroy();
              } catch (pdfTextErr: any) {
                console.warn(`[PDF getText Error] ${pdfTextErr.message}`);
              }
              
              // Step 2: If text extraction failed/garbled, convert PDF to PNG image
              if (!pdfTextExtracted) {
                try {
                  console.log('[PDF] Text not usable — converting PDF to PNG image...');
                  const { pdfToPng } = await import('pdf-to-png-converter');
                  const pages = await pdfToPng(new Uint8Array(fileBuffer).buffer, {
                    disableFontFace: true,
                    viewportScale: 2.0,
                    pagesToProcess: [1],
                  });
                  if (pages.length > 0 && pages[0].content) {
                    mimeType = 'image/png';
                    fileBuffer = pages[0].content;
                    console.log(`[PDF] Converted to PNG successfully (${fileBuffer.length} bytes).`);
                  }
                } catch (pngErr: any) {
                  console.warn(`[PDF-to-PNG Error] ${pngErr.message}`);
                }
              }
            }

            // Vision processing for images and documents
            const SUPPORTED_VISION_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
            const isSupportedImage = SUPPORTED_VISION_MIMES.includes(mimeType);
            const thumbnail = isImage ? messageData.imageMessageData?.jpegThumbnail : messageData.documentMessageData?.jpegThumbnail;

            // If PDF text was extracted AND validated, skip vision — use text-only agent path
            if (pdfTextExtracted) {
              fileData = null;
              console.log('[PDF] Clean text extracted — skipping vision, using agent text path.');
            } else if ((isImage || isDocument) && fileBuffer) {
              const MAX_SIZE = 5 * 1024 * 1024; // 5MB limit
              const useThumbnail = !isSupportedImage || fileBuffer.length > MAX_SIZE;

              if (useThumbnail && thumbnail) {
                 console.log(`[VISION] Using thumbnail for ${mimeType}`);
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
              } else if (isDocument && mimeType === 'application/pdf' && originalPdfBuffer) {
                // FALLBACK: Convert PDF to PNG image, then send to GPT-4o Vision
                try {
                  console.log(`[VISION] No thumbnail. Converting PDF to PNG (${originalPdfBuffer.length} bytes)...`);
                  const { pdfToPng } = await import('pdf-to-png-converter');
                  const pages = await pdfToPng(new Uint8Array(originalPdfBuffer).buffer, {
                    disableFontFace: true,
                    viewportScale: 2.0,
                    pagesToProcess: [1],
                  });
                  if (pages.length > 0 && pages[0].content) {
                    const pngBase64 = pages[0].content.toString('base64');
                    fileData = {
                      type: 'image',
                      image: `data:image/png;base64,${pngBase64}`,
                      mimeType: 'image/png'
                    } as any;
                    text = `${text || '[מסמך PDF]'} (תמונה שהומרה מ-PDF מצורפת לניתוח)`;
                    console.log(`[VISION] PDF converted to PNG successfully (${pages[0].content.length} bytes).`);
                  } else {
                    throw new Error('pdfToPng returned no pages');
                  }
                } catch (pngErr: any) {
                  console.error(`[VISION] PDF-to-PNG conversion failed: ${pngErr.message}`);
                  throw new Error(`לא הצלחתי להמיר את ה-PDF לתמונה. אנא שלח צילום מסך (JPG) של המסמך.`);
                }
              } else if (text && text.length > 10) {
                // Have some extracted text — proceed with text-only analysis
                console.log('[VISION] Proceeding with extracted text only (no image available).');
              } else {
                // No image, no thumbnail, no text — truly can't process
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
        - אדם (Owner): ${isSuperUser ? '**כן — אתה מדבר עם הבעלים עצמו. בצעי כל פעולה ישירות עם הכלים. אסור להגיד מעבירה לטיפול אדם כי הוא זה ששולח לך.**' : 'לא — זה לקוח או עובד.'}.
        ${isAccountant ? `- **איש קשר מוכר: אייל אסרף — רואה החשבון של העסק.**
          - דברי איתו בטון חברי, לא-רשמי, אבל מקצועי.
          - הציגי את עצמך בכל פנייה חדשה ("היי אייל, אני רותם, הנציגה הדיגיטלית של איי קיי 😊✨").
          - כשהוא מבקש משהו מאדם — ענו בסגנון: "אין בעיה, אני מעדכנת את אדם והוא יחזור אליך בהקדם 🙏". אל תנסי לטפל בבקשה בעצמך.
          - אם הוא שואל שאלה כללית שאת יכולה לענות — עני בשמחה.` : ''}
        ${isNewContact ? `- **מספר חדש — קראי את ההודעה לפני הכל**: זוהי הפנייה הראשונה. **אל תשלחי אוטומטית תפריט פתיחה.** קודם כל הבני את ההקשר:\n  • אם מתוכן ההודעה משתמע בבירור שזה **לקוח קיים** (למשל: פונים אל "אדם", מבקשים חומרי ניקיון כמו אקונומיקה או שקיות שחורות, מדווחים על חוסרים במשרד, או מדברים על בעיות ניקיון) — **זה לקוח קיים!** בשום אופן אל תציגי את עצמך ואל תשלחי תפריט! עני בטבעיות, בצורה שירותית קצרה, והבטיחי שתעבירי לאדם לטיפול.
  • אם ההודעה היא מ**שליח / קורייר / חברת משלוחים** — ענה ישירות על הבקשה הלוגיסטית בלבד. ללא הצגה עצמית, ללא תפריט.\n  • אם ההודעה היא **פנייה עסקית אמיתית** — הציגי את עצמך ואחר כך הצגת תפריט:\n  \\"היי${contactName ? ' ' + contactName : (senderName ? ' ' + senderName : '')}, אני רותם, הנציגה הדיגיטלית של איי קיי חברת ניקיון ואחזקה 😊✨\\"\n  \\"כדי שאוכל לעזור לך בצורה הטובה ביותר, ספר/י לי מי את/ה:\n  1️⃣ לקוח/ה קיים/ת — שאלה, שינוי או בקשה\n  2️⃣ לקוח/ה חדש/ה — מחיר, מידע על שירותים\n  3️⃣ אחר — ספק, שיתוף פעולה או נושא אחר\\"\n  • בכל מקרה אחר — ענה בטבעיות בלי תפריט.` : ''}
      `;

      const agent = mastra.getAgent('whatsapp-agent');
      currentStage = 'agent_generation';

      // HISTORY CONSTRUCTION — ARCHITECTURAL FIX:
      // The model CANNOT reliably ignore history even with explicit instructions.
      // Solution: Don't send history unless it's genuinely needed for the current exchange.
      
      const now = new Date();
      let historyForPrompt: any[] = [];

      if (isSuperUser) {
        // OWNER (Adam): Every message is fully independent — no history injection.
        // Injecting only the previous user message (without the assistant reply) caused
        // the model to respond to both the old and new question simultaneously.
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
        if (fileData) {
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
                model: 'gpt-4o',
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
          result = await agentGenerateWithRetry(agent, messages, { maxSteps: 8 });
        }
      } catch (e: any) {
        console.error(`[Vision AI Error/SDK] Error: ${e.message}`, e);
        if (fileData) {
          let errorDetail = e.message;
          if (e.response?.data) {
             errorDetail = `${e.message} ServerResponse: ${JSON.stringify(e.response.data).substring(0, 500)}`;
          } else if (e.cause) {
             errorDetail = `${e.message} Cause: ${e.cause}`;
          }

          const imgHead = (typeof fileData.image === 'string') ? fileData.image.substring(0, 30) : 'Binary';
          const imgInfo = (typeof fileData.image === 'string') ? `DataURL(${fileData.image.length}) Head: ${imgHead}` : `Buf`;
          visionError = `${errorDetail} (Mime: ${fileData.mimeType || 'unknown'}, Img: ${imgInfo}, Chat: ${chatId}, Owner: ${isSuperUser})`;
          
          // Don't run agent again — go straight to the hard-stop error block below
          result = { text: '' };
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
        const BUILD_ID = 'BUILD_10.06.26_PDF_QUALITY_CHECK';
        replyText += `\n\n_v${BUILD_ID}_`;
      }

      if (replyText.includes('[IGNORE]') || replyText.toLowerCase().includes('no response needed') || replyText.toLowerCase().includes('ignore')) {
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
           let ttsText = replyText.replace(/https?:\/\/[^\s]+/g, '').trim();
           const ttsBuffer = await elevenLabs.textToSpeech(ttsText);
           const uploadUrl = await greenApi.uploadFile(ttsBuffer, 'audio/mpeg', 'reply.mp3');
           await greenApi.sendFileByUrl(chatId, uploadUrl, 'reply.mp3');
         } catch (e: any) {
           console.error(`[TTS Error] ${e.message}`);
           await greenApi.sendMessage(chatId, replyText);
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
        const rawSender = body?.senderData?.sender || '';
        const isSuperUserCtx = rawSender.replace(/\D/g, '').slice(-9) === '526672663';
        let errorMsg: string;
        if (isRateLimitError(error)) {
          console.warn(`[RATE_LIMIT_FINAL] All retries exhausted at stage: ${currentStage}`);
          errorMsg = isSuperUserCtx
            ? `\u200F⚠️ *Rate Limit (${currentStage}):* ה-API של Grok עמוס. נסה שוב בעוד כמה שניות.`
            : `\u200Fסליחה, אני עמוסה כרגע 🙏\n\u200Fנסה/י שוב בעוד כמה שניות 😊`;
        } else {
          errorMsg = `\u200F⚠️ *שגיאת מערכת:* (${currentStage})\n\u200Fפירוט: ${error.message}`;
        }
        await greenApi.sendMessage(chatId, errorMsg);
      }
    } catch (e) {}
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
