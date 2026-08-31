export default {
  id: "v0-vercel-web",
  priority: 150,
  alias: "v0w",
  aliases: [
    "v0w",
  ],
  uiAlias: "v0w",
  display: {
    name: "v0 Vercel Web",
    icon: "auto_awesome",
    color: "#000000",
    textIcon: "V0",
    website: "https://v0.dev",
    notice: "v0 Vercel Web session. Code generation focused.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your session cookie from v0.dev",
  transport: {
    baseUrl: "https://v0.dev/api/chat",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "v0-default", name: "v0 Default" },
  ],
  passthroughModels: true,
};
