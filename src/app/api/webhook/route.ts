import { NextRequest, NextResponse } from 'next/server';
import { mastra } from '@/mastra';
import { greenApi } from '@/lib/green-api';
import { saveMessage, getHistory, isBotActive, setBotStatus, isWebhookProcessed } from '@/lib/supabase';
import { elevenLabs } from '@/lib/elevenlabs';

export async function POST(req: NextRequest) {
  const APP_VERSION = 'v4.2-VISION-READY';
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
        const mimeType = messageData.fileMessageData?.mimeType || 
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
            
            // Vision processing for images and documents
            const SUPPORTED_VISION_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
            const isSupportedImage = SUPPORTED_VISION_MIMES.includes(mimeType);
            const thumbnail = isImage ? messageData.imageMessageData?.jpegThumbnail : messageData.documentMessageData?.jpegThumbnail;

            if (isImage || isDocument) {
              const MAX_SIZE = 5 * 1024 * 1024; // 5MB limit
              const useThumbnail = !isSupportedImage || fileBuffer.length > MAX_SIZE;

              if (useThumbnail && thumbnail) {
                 console.log(`[VISION] Using thumbnail for ${mimeType}`);
                 const cleanThumbnail = thumbnail.replace(/^data:image\/[a-z]+;base64,/, '').replace(/\s/g, '');
                 const base64Prefix = `data:image/jpeg;base64,`;
                 
                 fileData = { 
                   type: 'image', 
                   image: base64Prefix + cleanThumbnail,
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

      const historyLegacy = history.filter((h: any) => h.content !== text && h.content !== placeholder).slice(-5);
      
      const promptContentParts: any[] = [];
      if (fileData) {
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

      console.time(`[${APP_VERSION}] agent-generate`);
      let result: any;
      try {
        result = await agent.generate(messages, { maxSteps: 3 });
      } catch (e: any) {
        console.error(`[Vision AI Error/Grok] Error: ${e.message}`, e);
        if (fileData) {
          // Add details to the technical error to help identification
          const imgInfo = typeof fileData.image === 'string' ? `Str(${fileData.image.length})` : `Buf`;
          visionError = `${e.message} (Mime: ${fileData.mimeType}, Img: ${imgInfo})`;
          const textOnlyMessages = messages.map((m: any) => {
             if (m.role === 'user' && Array.isArray(m.content)) {
                return { ...m, content: (m.content as any[]).filter(p => p.type === 'text').map(p => p.text).join('\n') };
             }
             return m;
          });
          
          result = await agent.generate(textOnlyMessages, {
            maxSteps: 3,
            instructions: authInstructions + '\n\nשימי לב: הייתה בעיה טכנית בניתוח התמונה. התנצלי והציעי לשלוח שוב כ-JPG.'
          });
        } else {
          throw e;
        }
      }
      console.timeEnd(`[${APP_VERSION}] agent-generate`);

      currentStage = 'sending_response';
      let replyText = result.text || 'סליחה, נתקלתי בבעיה קטנה.';
      
      if (visionError && isSuperUser) {
        replyText += `\n\n[אבחון טכני: ${visionError}]`;
      }

      const BUILD_ID = 'BUILD_13:05_URL_STRATEGY';
      if (isSuperUser) {
         replyText += `\n\n_v${BUILD_ID}_`;
      }

      if (replyText.includes('[IGNORE]')) {
        await saveMessage(chatId, 'assistant', '[בוט התעלם - ברכת חג]');
        return NextResponse.json({ status: 'ignored_by_agent_policy' });
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
