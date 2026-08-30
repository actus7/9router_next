export default {
  id: "nanogpt",
  alias: "nanogpt",
  display: {
    name: "NanoGPT",
    icon: "bolt",
    color: "#7C3AED",
    textIcon: "NG",
    website: "https://nano-gpt.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://nano-gpt.com/api/v1/chat/completions",
    format: "openai",
    validateUrl: "https://nano-gpt.com/api/v1/models",
    modelsFetcher: { url: "https://nano-gpt.com/api/v1/models", type: "openai" },
  },
  models: [
    { id: "chatgpt-4o-latest", name: "ChatGPT 4o Latest" },
    { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
    { id: "gpt-4o-mini", name: "GPT 4o Mini" },
  ],
};
