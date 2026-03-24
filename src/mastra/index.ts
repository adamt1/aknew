import { Mastra } from "@mastra/core/mastra";
import { whatsappAgent } from "./agents/whatsapp-agent";
import { whatsappAgentFallback } from "./agents/whatsapp-agent-fallback";

export const mastra = new Mastra({
  agents: {
    "whatsapp-agent": whatsappAgent,
    "whatsapp-agent-fallback": whatsappAgentFallback,
  },
});
