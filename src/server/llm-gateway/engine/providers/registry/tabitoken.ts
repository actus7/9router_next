import { CLAUDE_API_HEADERS } from "../shared";

export default {
  id: "tabitoken",
  alias: "tabi",
  aliases: ["tabitoken"],
  display: {
    name: "Tabitoken",
    icon: "token",
    color: "#8B5CF6",
    textIcon: "TB",
    website: "https://tabitoken.com",
    notice: {
      text: "NewAPI-based Claude gateway. Dual protocol: Anthropic Messages (default) + OpenAI.",
      apiKeyUrl: "https://api.tabitoken.com/dashboard",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.tabitoken.com/v1/messages",
    format: "claude",
    headers: { ...CLAUDE_API_HEADERS },
    auth: { header: "x-api-key", scheme: "raw" },
  },
  // Multi-protocol: 2 endpoints — Claude Messages (default) + OpenAI
  transports: [
    {
      format: "claude",
      baseUrl: "https://api.tabitoken.com/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { header: "x-api-key", scheme: "raw" },
    },
    {
      format: "openai",
      baseUrl: "https://api.tabitoken.com/v1/chat/completions",
    },
  ],
  models: [
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-opus-4-7-thinking", name: "Claude Opus 4.7 Thinking" },
  ],
  passthroughModels: true,
};
