import { elevenLabs } from './src/lib/elevenlabs';

(elevenLabs as any).apiKey = 'sk_2f08c94ec5ddbcd6ba958fd06887e477022d6986fefab5cf';

async function run() {
  try {
    const fs = require('fs');
    console.log('Testing TTS...');
    const audio = await elevenLabs.textToSpeech('שלום, זה בדיקה.');
    console.log('TTS Success, audio length:', audio.length);

    console.log('Testing STT with the generated audio...');
    const text = await elevenLabs.speechToText(audio, 'audio/mpeg');
    console.log('STT Success:', text);
  } catch (e) {
    console.error('Error:', e);
  }
}
run();
