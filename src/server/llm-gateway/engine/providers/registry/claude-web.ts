export default {
  id: "claude-web",
  priority: 150,
  alias: "clw",
  aliases: [
    "clw",
  ],
  uiAlias: "clw",
  display: {
    name: "Claude Web",
    icon: "auto_awesome",
    color: "#D97706",
    textIcon: "CLW",
    website: "https://claude.ai",
    notice: "Claude Web session. Tools are silenced.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your session cookie from claude.ai",
  transport: {
    baseUrl: "https://claude.ai/api/chat",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
  ],
  passthroughModels: true,
};
