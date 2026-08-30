export default {
  id: "token-kiosk",
  alias: "tk",
  display: {
    name: "Token Kiosk",
    icon: "bolt",
    color: "#10B981",
    textIcon: "TK",
    website: "https://agent-router.gaib.ai",
    notice: {
      apiKeyUrl: "https://agent-router.gaib.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://agent-router.gaib.ai/v1/chat/completions",
    format: "openai",
    validateUrl: "https://agent-router.gaib.ai/v1/models",
    modelsFetcher: { url: "https://agent-router.gaib.ai/v1/models", type: "openai" },
  },
  models: [
    { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", contextLength: 200000 },
    { id: "deepseek-v3", name: "DeepSeek V3", contextLength: 64000 },
    { id: "deepseek-r1", name: "DeepSeek R1", contextLength: 64000 },
    { id: "kimi-k1.5", name: "Kimi K1.5", contextLength: 128000 },
    { id: "minimax-m6", name: "MiniMax M6", contextLength: 128000 },
  ],
};
