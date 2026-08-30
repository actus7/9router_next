export default {
  id: "poe",
  alias: "poe",
  display: {
    name: "Poe",
    icon: "bolt",
    color: "#8B5CF6",
    textIcon: "PO",
    website: "https://poe.com",
    notice: {
      apiKeyUrl: "https://poe.com/api_key",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.poe.com/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "gemini-3.0-pro", name: "Gemini 3.0 Pro" },
  ],
};
