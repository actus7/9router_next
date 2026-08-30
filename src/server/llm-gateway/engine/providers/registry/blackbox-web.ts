export default {
  id: "blackbox-web",
  alias: "bbw",
  uiAlias: "bbw",
  display: {
    name: "Blackbox Web",
    icon: "terminal",
    color: "#1A1A2E",
    textIcon: "BB",
    website: "https://blackbox.ai",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your __Secure-authjs.session-token from blackbox.ai",
  notice: "Blackbox Web session. Emulated tool calling.",
  transport: {
    baseUrl: "https://www.blackbox.ai/api/chat",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "blackbox-default", name: "Blackbox Default" },
  ],
  passthroughModels: true,
};
