export default {
  id: "lmarena",
  alias: "arena",
  uiAlias: "arena",
  display: {
    name: "Arena (Free)",
    icon: "stadium",
    color: "#F59E0B",
    textIcon: "LA",
    website: "https://arena.ai",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your full cookie from arena.ai",
  notice: "Free Arena (LMSYS). TLS fingerprinting may be required.",
  transport: {
    baseUrl: "https://arena.ai/api/chat",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "arena-default", name: "Arena Default" },
  ],
  passthroughModels: true,
};
