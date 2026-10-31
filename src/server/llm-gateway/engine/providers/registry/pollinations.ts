export default {
  id: "pollinations",
  alias: "pl",
  display: {
    name: "Pollinations AI",
    icon: "public",
    color: "#10B981",
    textIcon: "PL",
    website: "https://pollinations.ai",
    notice: {
      text: "Shared-capacity API. A Pollinations publishable (pk_) or secret (sk_) key is required for chat completions.",
      apiKeyUrl: "https://enter.pollinations.ai",
    },
  },
  category: "free",
  authType: "apikey",
  transport: {
    baseUrl: "https://gen.pollinations.ai/v1/chat/completions",
    retry: {
      402: { attempts: 1, delayMs: 8000 },
      429: { attempts: 1, delayMs: 5000 },
    },
  },
};
