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
  },
  modelsFetcher: { url: "https://agent-router.gaib.ai/v1/models", type: "openai" },
};
