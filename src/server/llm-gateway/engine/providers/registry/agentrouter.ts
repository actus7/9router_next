import { CLAUDE_API_HEADERS } from "../shared";

export default {
  id: "agentrouter",
  alias: "ar",
  aliases: ["agentrouter"],
  display: {
    name: "AgentRouter",
    icon: "router",
    color: "#6366F1",
    textIcon: "AR",
    website: "https://agentrouter.org",
    notice: {
      text: "$200 free credits. Multi-protocol: supports OpenAI, Anthropic Messages, and Responses APIs.",
      apiKeyUrl: "https://agentrouter.org/dashboard/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://agentrouter.org/v1/chat/completions",
    format: "openai",
  },
  // Multi-protocol: 3 endpoints — OpenAI, Claude Messages, OpenAI Responses
  transports: [
    {
      format: "openai",
      baseUrl: "https://agentrouter.org/v1/chat/completions",
    },
    {
      format: "claude",
      baseUrl: "https://agentrouter.org/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { header: "x-api-key", scheme: "raw" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://agentrouter.org/v1/responses",
    },
  ],
  modelsFetcher: { url: "https://agentrouter.org/v1/models", type: "openai" },
  passthroughModels: true,
};
