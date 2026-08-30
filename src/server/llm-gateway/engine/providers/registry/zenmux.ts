import { CLAUDE_API_HEADERS } from "../shared";

export default {
  id: "zenmux",
  alias: "zenmux",
  display: {
    name: "ZenMux",
    icon: "hub",
    color: "#14B8A6",
    textIcon: "ZX",
    website: "https://zenmux.ai",
    notice: {
      text: "Free: Gemini 3 Flash, DeepSeek V3.2, Grok 4.1 Fast. Multi-protocol: OpenAI + Anthropic + Vertex AI.",
      apiKeyUrl: "https://zenmux.ai/dashboard/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://zenmux.ai/api/v1/chat/completions",
    format: "openai",
  },
  // Multi-protocol: 3 endpoints — OpenAI, Claude Messages, Vertex AI (Gemini)
  transports: [
    {
      format: "openai",
      baseUrl: "https://zenmux.ai/api/v1/chat/completions",
    },
    {
      format: "claude",
      baseUrl: "https://zenmux.ai/api/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { header: "x-api-key", scheme: "raw" },
    },
    {
      format: "gemini",
      baseUrl: "https://zenmux.ai/api/v1/vertex",
    },
  ],
  modelsFetcher: { url: "https://zenmux.ai/api/v1/models", type: "openai" },
  passthroughModels: true,
};
