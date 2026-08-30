export default {
  id: "t3-web",
  alias: "t3w",
  uiAlias: "t3w",
  display: {
    name: "t3.chat",
    icon: "chat",
    color: "#0EA5E9",
    textIcon: "T3",
    website: "https://t3.chat",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your convex-session-id cookie from t3.chat",
  notice: "t3.chat — free with limits. Emulated tool calling.",
  transport: {
    baseUrl: "https://t3.chat/api/chat",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "t3-default", name: "t3 Default" },
  ],
  passthroughModels: true,
};
