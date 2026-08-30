export default {
  id: "conol-web",
  alias: "conol",
  aliases: ["conol-web", "conolai"],
  uiAlias: "conol",
  display: {
    name: "Conol",
    icon: "hub",
    color: "#10B981",
    textIcon: "CO",
    website: "https://conol.ai",
    notice: "Experimental Conol session.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your __Secure-better-auth.session_token from conol.ai",
  transport: {
    baseUrl: "https://conol.ai/api/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "conol-default", name: "Conol Default" },
  ],
};
