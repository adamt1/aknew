import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class ElevenLabsClient {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';
  private defaultVoiceId = 'EXAVITQu4vr4xnSDxMaL'; // Bella - Soft female voice
  private ttsModelId = 'eleven_v3';
  private sttModelId = 'scribe_v1';

  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY || '';
    if (!this.apiKey) {
      console.warn('ELEVENLABS_API_KEY is not defined in the environment.');
    }
  }

  /**
   * Converts an audio buffer to text (Speech to Text)
   * Using ElevenLabs Speech-to-Text API
   */
  async speechToText(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string> {
    if (!this.apiKey) throw new Error("Missing ElevenLabs API key");

    // We need to construct a multipart/form-data request manually or use Blob/FormData
    // In Node.js 18+, fetch supports FormData globally.
    const formData = new FormData();
    
    // We wrap the buffer in a blob
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append("file", blob, "audio_message.ogg");
    
    // According to docs, the model ID for speech to text is sent in the body
    formData.append("model_id", this.sttModelId);

    const response = await fetch(`${this.baseUrl}/speech-to-text`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        // When passing a FormData instance to fetch, do NOT set the 'Content-Type' header explicitly.
        // Fetch will automatically generate the correct boundary string.
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ElevenLabs STT Error: ${response.status} - ${errorText}`);
      throw new Error(`ElevenLabs STT failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.text || '';
  }

  /**
   * Converts text to audio buffer (Text to Speech)
   */
  async textToSpeech(text: string): Promise<Buffer> {
    if (!this.apiKey) throw new Error("Missing ElevenLabs API key");

    const url = `${this.baseUrl}/text-to-speech/${this.defaultVoiceId}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: this.ttsModelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        }
      }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`ElevenLabs TTS Error: ${response.status} - ${errorText}`);
        throw new Error(`ElevenLabs TTS failed: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

export const elevenLabs = new ElevenLabsClient();
