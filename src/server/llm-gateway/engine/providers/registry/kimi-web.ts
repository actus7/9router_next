export default {
  id: "kimi-web",
  alias: "kimiw",
  uiAlias: "kimiw",
  display: {
    name: "Kimi Web",
    icon: "psychology",
    color: "#7C3AED",
    textIcon: "KW",
    website: "https://kimi.ai",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your access_token from Local Storage of www.kimi.ai",
  notice: "Kimi Web session.",
  transport: {
    baseUrl: "https://www.kimi.ai/api/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "kimi-latest", name: "Kimi Latest" },
  ],
  passthroughModels: true,
};
