export default {
  id: "zenmux-free",
  priority: 150,
  alias: "zmf",
  aliases: [
    "zmf",
  ],
  uiAlias: "zmf",
  display: {
    name: "ZenMux Free",
    icon: "auto_awesome",
    color: "#6366F1",
    textIcon: "ZMF",
    website: "https://zenmux.ai",
    notice: "Free ZenMux Web. Refresh ~30 days.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your full exported cookie from zenmux.ai",
  transport: {
    baseUrl: "https://zenmux.ai/api/v1/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "gemini-3-flash", name: "Gemini 3 Flash" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
    { id: "grok-4.1-fast", name: "Grok 4.1 Fast" },
  ],
  passthroughModels: true,
};
