export class GreenApiService {
  private get apiUrl() { return process.env.GREEN_API_URL || ''; }
  private get idInstance() { return process.env.GREEN_API_ID_INSTANCE || ''; }
  private get apiTokenInstance() { return process.env.GREEN_API_TOKEN_INSTANCE || ''; }

  private getUrl(method: string) {
    if (!this.apiUrl || !this.idInstance || !this.apiTokenInstance) {
      throw new Error('Green API environment variables are not set');
    }
    return `${this.apiUrl}/waInstance${this.idInstance}/${method}/${this.apiTokenInstance}`;
  }

  async sendMessage(chatId: string, message: string) {
    const url = this.getUrl('sendMessage');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatId,
        message,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to send message');
    }

    return response.json();
  }

  async setChatPresence(chatId: string, presence: 'composing' | 'recording' | 'paused') {
    const url = this.getUrl('setChatPresence');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatId,
        presence,
      }),
    });

    if (!response.ok) {
      console.warn('Failed to set chat presence:', await response.text());
    }
  }

  async getStateInstance() {
    const url = this.getUrl('getStateInstance');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to get instance state');
    }
    return response.json();
  }

  async getContactInfo(chatId: string) {
    const url = this.getUrl('getContactInfo');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ chatId }),
    });
    if (!response.ok) {
      throw new Error('Failed to get contact info');
    }
    return response.json();
  }

  async downloadFile(downloadUrl: string): Promise<Buffer> {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async uploadFile(buffer: Buffer, mimeType: string, filename?: string): Promise<string> {
    const url = this.getUrl('uploadFile');
    
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
    };
    if (filename) {
      headers['GA-Filename'] = filename;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: blobFromBuffer(buffer, mimeType), // We need to create a blob for Node fetch if it strictly expects Blob/FormData for binary POST, but standard `fetch` handles Buffer/Uint8Array natively as body. Let's just pass buffer directly.
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Failed to upload file to Green API: ${err}`);
    }

    const data = await response.json();
    return data.urlFile;
  }

  async sendFileByUrl(chatId: string, urlFile: string, fileName: string, caption?: string) {
    const url = this.getUrl('sendFileByUrl');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatId,
        urlFile,
        fileName,
        caption,
      }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Failed to send file by URL: ${err}`);
    }

    return response.json();
  }
}

function blobFromBuffer(buffer: Buffer, type: string) {
  return new Blob([new Uint8Array(buffer)], { type });
}

export const greenApi = new GreenApiService();
