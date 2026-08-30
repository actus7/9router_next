export default {
  id: "moonshot",
  alias: "ms",
  display: {
    name: "Moonshot",
    icon: "rocket_launch",
    color: "#6366F1",
    textIcon: "MS",
    website: "https://platform.moonshot.ai",
    notice: {
      apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    },
  },
  category: "apikey",
  authHint: "Paste your Moonshot API key from https://platform.moonshot.ai/console/api-keys",
  transport: {
    baseUrl: "https://api.moonshot.ai/v1/chat/completions",
    validateUrl: "https://api.moonshot.ai/v1/models",
  },
  models: [
    { id: "kimi-k2-0711-preview", name: "Kimi K2", tools: true },
    { id: "moonshot-v1-8k", name: "Moonshot v1 8K", tools: true },
    { id: "moonshot-v1-32k", name: "Moonshot v1 32K", tools: true },
    { id: "moonshot-v1-128k", name: "Moonshot v1 128K", tools: true },
  ],
};
