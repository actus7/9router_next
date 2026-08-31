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
    baseUrl: "https://conol.ai/api/sessions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "claude-sonnet-5", name: "Claude Sonnet 5 (via Conol)" },
    { id: "claude-fable-5", name: "Claude Fable 5 (via Conol)" },
    { id: "gpt-5.5", name: "GPT-5.5 (via Conol)" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro (via Conol)" },
  ],
};
