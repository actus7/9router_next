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
    website: "https://inner.ai",
    notice: "Inner.ai session.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your token cookie from inner.ai",
  transport: {
    baseUrl: "https://inner.ai/api/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "inner-default", name: "Inner Default" },
  ],
};
