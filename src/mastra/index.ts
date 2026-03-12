import { Mastra } from "@mastra/core/mastra";
import { whatsappAgent } from "./agents/whatsapp-agent";

export const mastra = new Mastra({
  agents: {
    "whatsapp-agent": whatsappAgent,
  },
});
