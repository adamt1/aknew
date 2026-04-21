import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/mastra';
import { Agent } from "@mastra/core/agent";
import { pdfToPng } from 'pdf-to-png-converter';
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { greenApi } from '@/lib/green-api';
import { saveMessage, getHistory, isBotActive, setBotStatus, isWebhookProcessed } from '@/lib/supabase';
import { elevenLabs } from '@/lib/elevenlabs';
import heicConvert from 'heic-convert';
import { processDueReminders } from '@/lib/reminders';

export async function POST(req: NextRequest) {
  const APP_VERSION = 'v4.9-FOCUS_FIX';
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
    console.log('FULL WEBHOOK BODY:', JSON.stringify(body, null, 2));
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
      const senderName = pushName || contactName || '';

      // Filters
      const blacklist = ['אמא', 'Mom', 'אוריה חיים שלי', 'אריאלי', 'שלומי ידיד', 'קימי', 'קארין', 'סבינה גננת'];
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

      currentStage = 'processing_media';

      const isImage = typeMessage === 'imageMessage';
      const isDocument = typeMessage === 'documentMessage';
      const isVideo = typeMessage === 'videoMessage';

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
      } else if (isImage || isDocument || isVideo) {
        const downloadUrl = messageData.fileMessageData?.downloadUrl || 
                            messageData.imageMessageData?.downloadUrl || 
                            messageData.documentMessageData?.downloadUrl ||
                            messageData.videoMessageData?.downloadUrl;
        
        const idMessage = body.idMessage;
        let mimeType = messageData.fileMessageData?.mimeType || 
                         messageData.imageMessageData?.mimeType || 
                         messageData.documentMessageData?.mimeType || 
                         messageData.videoMessageData?.mimeType ||
                         (isImage ? 'image/jpeg' : isVideo ? 'video/mp4' : 'application/pdf');

        try {
          let fileBuffer: Buffer | null = null;
          if (downloadUrl) {
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
              } else if (text?.includes('--- תוכן טקסטואלי שחולץ מהמסמך ---')) {
                // If we have text but no image, it's fine
                console.log('[VISION] Proceeding with extracted text only.');
              } else {
                // HEIC/PDF without thumbnail or text
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
      await saveMessage(chatId, 'user', text || placeholder);
      const history = await getHistory(chatId);

      const messageDate = body.timestamp ? new Date(body.timestamp * 1000) : new Date();
      const serverDate = new Date();
      
      const dateStrHe = messageDate.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const timeStrHe = messageDate.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false });
      const serverTimeHe = serverDate.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false });
      const isSignificantDelay = Math.abs(serverDate.getTime() - messageDate.getTime()) > 3600000;

      const authInstructions = `
        הנחיות קריטיות:
        - היום ${dateStrHe}. שעה: ${serverTimeHe}.
        - הנציגה הדיגיטלית של איי קיי חברת ניקיון ואחזקה.
        - כל שורה מתחילה ב-RLM (\u200F).
        - טון לבבי ושירותי 😊✨.
        - שם לקוח: ${senderName}. אדם (Owner): ${isSuperUser ? 'כן' : 'לא'}.
      `;

      const agent = mastra.getAgent('whatsapp-agent');
      currentStage = 'agent_generation';

      const historyLegacy = history
        .filter((h: any) => {
          const content = (h.content || '').toLowerCase();
          // RADICAL PURGE: Completely block messages containing noise topics seen in previous regressions
          const isNoisy = 
                 content.includes('מחיר הכפפות') || 
                 content.includes('תרסיס אקונומיקה') || 
                 content.includes('מחירי חומרי ניקיון') || 
                 content.includes('שמחה לעזור לך עם כל הבקשות') ||
                 content.includes('חומרי ניקיון שהיו חסרים') ||
                 content.includes('סיכום של השיחה') ||
                 content.includes('לינק יוסיף בהמשך') ||
                 content.includes('משרדים בחודש אפריל') ||
                 content.includes('פגישה עם') && content.includes('[לינק');

          if (isNoisy) return false;

          return !content.includes('[אבחון טכני:') && 
                 !content.includes('_vbuild_') && 
                 content !== (text || '').toLowerCase() && 
                 content !== (placeholder || '').toLowerCase();
        })
        .slice(-2); // Extreme focus: Only 2 latest messages
      
      const promptContentParts: any[] = [];
      
      if (fileData) {
        // Reorder: Image FIRST
        promptContentParts.push(fileData);
      }

      promptContentParts.push({ type: 'text', text: text || 'שלום' });

      const messages: any[] = [
        { role: 'system', content: authInstructions },
        ...historyLegacy.map((h: any) => ({
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

          // DEEP PROBE: Use native fetch to see the RAW error from xAI
          const xaiResponse = await fetch('https://api.x.ai/v1/chat/completions', {
             method: 'POST',
             headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${process.env.XAI_API_KEY}`
             },
             body: JSON.stringify({
                model: 'grok-4.20-0309-reasoning',
                stream: false,
                store: true,
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

          const resultJson = await xaiResponse.json();

          if (!xaiResponse.ok) {
            throw new Error(`Probe failed (${xaiResponse.status}): ${JSON.stringify(resultJson).substring(0, 500)}`);
          }

          const summary = resultJson.choices?.[0]?.message?.content || 'No summary generated.';
          visionError = `SUCCESS_PROBE (Status: ${xaiResponse.status}, Len: ${summary.length}, Head: ${summary.substring(0, 30)})`;
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
        const BUILD_ID = 'BUILD_21.04.26_SYNC_FIX_V4';
        replyText += `\n\n_v${BUILD_ID}_`;
      }

      if (replyText.includes('[IGNORE]')) {
        await saveMessage(chatId, 'assistant', '[בוט התעלם - ברכת חג]');
        return NextResponse.json({ status: 'ignored_by_agent_policy' });
      }

      // CRITICAL: If vision failed, DO NOT guess. Stop here and return error.
      if (visionError) {
         const errorPrefix = `\u200Fסליחה אדם, חלה תקלה טכנית בקריאת הקובץ:`;
         const finalErrorStr = `${errorPrefix}\n\n[אבחון טכני: ${visionError}]\n\nאנא נסה לשלוח שוב כצילום מסך (JPG).`;
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
    return NextResponse.json({ error: error.message }, { status: 200 });
  }
}
