import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { icount, ICountDocPayload } from "../../lib/icount";

export const createICountDocument = createTool({
  id: "createICountDocument",
  description: "Creates an accounting document in iCount (like invoice, receipt, or quote) and returns its details.",
  inputSchema: z.object({
    client_name: z.string().describe("The name of the client receiving the document."),
    doctype: z.enum(["invrec", "invoice", "receipt", "offer"]).describe("Type of document: 'invrec' (חשבונית מס קבלה), 'invoice' (חשבונית מס), 'receipt' (קבלה), or 'offer' (הצעת מחיר)."),
    items: z.array(z.object({
      description: z.string().describe("Description of the item or service."),
      unitprice: z.number().describe("Price per unit before tax."),
      quantity: z.number().describe("Quantity of the item.")
    })).describe("List of items to include in the document. Ensure prices and quantities are numeric.")
  }),
  execute: async (inputData) => {
    try {
      const payload: ICountDocPayload = {
        client_name: inputData.client_name,
        doctype: inputData.doctype,
        items: inputData.items
      };
      
      const response = await icount.createDocument(payload);
      return { 
        success: true, 
        message: 'Document created successfully.', 
        doc_url: response.doc_url || response.url || 'No URL returned by API',
        data: response 
      };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message || 'Unknown error occurred while creating document.',
        CRITICAL_INSTRUCTION_FOR_AI: "THE DOCUMENT CREATION FAILED. DO NOT HALLUCINATE A DOCUMENT OR NUMBER. Tell the user exactly what the error is. If the error is 'bad_login' or 'credentials are not fully configured', explicitly tell the user: 'יש בעיה בפרטי ההתחברות ל-iCount. אנא ודא שהזנת נכון את המשתנים ICOUNT_CID, ICOUNT_USER, ICOUNT_PASS ב-Vercel Settings -> Environment Variables, ותעשה Redeploy'."
      };
    }
  }
});

export const listICountDocuments = createTool({
  id: "listICountDocuments",
  description: "Lists and summarizes accounting documents from iCount (invoices, receipts, etc.) by date range. Use this to check income, list invoices, or get financial summaries for a specific period.",
  inputSchema: z.object({
    doctype: z.enum(["invoice", "invrec", "receipt", "all"]).default("all").describe("Type of document to list: 'invoice' (חשבונית מס), 'invrec' (חשבונית מס קבלה), 'receipt' (קבלה), or 'all' (הכל)."),
    from_date: z.string().describe("Start date for the query range in YYYY-MM-DD format (e.g., '2026-01-01')."),
    to_date: z.string().describe("End date for the query range in YYYY-MM-DD format (e.g., '2026-01-31').")
  }),
  execute: async (inputData) => {
    try {
      const response = await icount.listDocuments({
        doctype: inputData.doctype,
        from_date: inputData.from_date,
        to_date: inputData.to_date
      });

      const docs = response.docs || response.data || response.results || [];
      
      if (!Array.isArray(docs) || docs.length === 0) {
        return {
          success: true,
          message: `לא נמצאו מסמכים בתקופה ${inputData.from_date} עד ${inputData.to_date}.`,
          total_docs: 0,
          total_amount: 0,
          documents: []
        };
      }

      // Calculate totals
      let totalAmount = 0;
      const docSummaries = docs.map((doc: any) => {
        const amount = parseFloat(doc.total || doc.amount || doc.sum || 0);
        totalAmount += amount;
        return {
          doc_number: doc.docnum || doc.doc_number || doc.id || 'N/A',
          client_name: doc.client_name || doc.customer_name || 'N/A',
          date: doc.issue_date || doc.date || doc.created_at || 'N/A',
          type: doc.doctype || inputData.doctype,
          amount: amount,
          currency: doc.currency || 'ILS'
        };
      });

      return {
        success: true,
        message: `נמצאו ${docs.length} מסמכים בתקופה ${inputData.from_date} עד ${inputData.to_date}.`,
        total_docs: docs.length,
        total_amount: totalAmount,
        currency: 'ILS',
        documents: docSummaries
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown error occurred while listing documents.',
        CRITICAL_INSTRUCTION_FOR_AI: "THE DOCUMENT LISTING FAILED. DO NOT HALLUCINATE NUMBERS OR INCOME. Tell the user exactly what the error is. If the error is 'bad_login' or 'credentials are not fully configured', explicitly tell the user: 'יש בעיה בפרטי ההתחברות ל-iCount. אנא ודא שהזנת נכון את המשתנים'."
      };
    }
  }
});
