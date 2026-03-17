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

  async request(module: string, method: string, payload: any = {}) {
    if (!this.config.cid || !this.config.user || !this.config.pass) {
      throw new Error(`iCount credentials are not fully configured. Missing CID: ${!this.config.cid}, USER: ${!this.config.user}, PASS: ${!this.config.pass}`);
    }

    const body = {
      cid: this.config.cid,
      user: this.config.user,
      pass: this.config.pass,
      ...payload,
    };

    const response = await fetch(`${this.baseUrl}/${module}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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

  async createDocument(payload: ICountDocPayload) {
    return this.request('doc', 'create', payload);
  }
}

export const icount = new ICountClient();
