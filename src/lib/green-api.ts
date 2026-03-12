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
}

export const greenApi = new GreenApiService();
