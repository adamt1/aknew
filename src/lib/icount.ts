export interface ICountConfig {
  cid: string;
  user: string;
  pass: string;
}

export interface ICountDocItem {
  description: string;
  unitprice: number;
  quantity: number;
}

export interface ICountDocPayload {
  client_name: string;
  doctype: string; // e.g., 'invrec' (חשבונית מס קבלה), 'invoice' (חשבונית מס), 'receipt' (קבלה), 'offer' (הצעת מחיר)
  items: ICountDocItem[];
  [key: string]: any;
}

export class ICountClient {
  private config: ICountConfig;
  private baseUrl = 'https://api.icount.co.il/api/v3.php';

  constructor(config?: Partial<ICountConfig>) {
    this.config = {
      cid: config?.cid || process.env.ICOUNT_CID || '',
      user: config?.user || process.env.ICOUNT_USER || '',
      pass: config?.pass || process.env.ICOUNT_PASS || '',
    };
  }

  private checkCredentials() {
    if (!this.config.cid || !this.config.user || !this.config.pass) {
      throw new Error(`iCount credentials are not fully configured. Missing CID: ${!this.config.cid}, USER: ${!this.config.user}, PASS: ${!this.config.pass}`);
    }
  }

  private async fetchApi(module: string, method: string, body: any) {
    const response = await fetch(`${this.baseUrl}/${module}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`iCount API HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.status) {
      throw new Error(`iCount logic error: ${data.reason || data.error_description || JSON.stringify(data)}`);
    }

    return data;
  }

  // Direct credentials auth (works for doc/create)
  async request(module: string, method: string, payload: any = {}) {
    this.checkCredentials();
    const body = {
      cid: this.config.cid,
      user: this.config.user,
      pass: this.config.pass,
      ...payload,
    };
    return this.fetchApi(module, method, body);
  }

  // Session-based auth (required for doc/search and other endpoints)
  async login(): Promise<string> {
    this.checkCredentials();
    const data = await this.fetchApi('auth', 'login', {
      cid: this.config.cid,
      user: this.config.user,
      pass: this.config.pass,
    });
    if (!data.sid) {
      throw new Error('iCount login succeeded but no sid returned');
    }
    return data.sid;
  }

  async requestWithSession(module: string, method: string, payload: any = {}) {
    const sid = await this.login();
    const body = { sid, ...payload };
    return this.fetchApi(module, method, body);
  }

  async createDocument(payload: ICountDocPayload) {
    return this.request('doc', 'create', payload);
  }

  async listDocuments(options: {
    doctype?: string;
    from_date?: string;
    to_date?: string;
  } = {}) {
    const payload: any = {};
    if (options.doctype && options.doctype !== 'all') {
      payload.doctype = options.doctype;
    }
    if (options.from_date) {
      payload.start_date = options.from_date;
    }
    if (options.to_date) {
      payload.end_date = options.to_date;
    }
    return this.requestWithSession('doc', 'search', { limit: 100, ...payload });
  }
}

export const icount = new ICountClient();
