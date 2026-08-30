export default {
  id: "kie",
  alias: "kie",
  category: "apikey",
  authType: "apikey",
  display: {
    name: "Kie.ai",
    icon: "smart_toy",
    color: "#6366F1",
    textIcon: "KI",
    website: "https://kie.ai",
    notice: {
      apiKeyUrl: "https://kie.ai",
    },
  },
  transport: {
    baseUrl: "https://api.kie.ai/v1/chat/completions",
  },
  models: [
    { id: "claude-5-opus", name: "Claude 5 Opus" },
    { id: "gpt-5.6", name: "GPT 5.6" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "grok-4.6", name: "Grok 4.6" },
  ],
};
