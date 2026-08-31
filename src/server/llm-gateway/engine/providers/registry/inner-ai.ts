export default {
  id: "inner-ai",
  alias: "inner",
  aliases: ["inner-ai", "innerai"],
  uiAlias: "inner",
  display: {
    name: "Inner.ai",
    icon: "psychology",
    color: "#6366F1",
    textIcon: "IA",
    website: "https://app.innerai.com",
    notice: "Inner.ai session. Model list resolved dynamically from your plan.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your token cookie from DevTools → Application → Cookies → .innerai.com (optionally followed by a space and your account email)",
  transport: {
    baseUrl: "https://chatapi.innerai.com/chat",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "gpt-4o", name: "GPT-4o (via Inner.ai)" },
  ],
};
