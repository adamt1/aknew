import { Agent } from "@mastra/core/agent";

export const whatsappAgent = new Agent({
  id: "whatsapp-agent",
  name: "Rotem ❤️",
  instructions: "", // We provide dynamic instructions in the webhook context
  model: "xai/grok-4-1-fast-non-reasoning",
});
