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
