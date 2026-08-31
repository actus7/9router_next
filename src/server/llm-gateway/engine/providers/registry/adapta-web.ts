export default {
  id: "adapta-web",
  alias: "adw",
  aliases: ["adapta-web"],
  uiAlias: "adw",
  display: {
    name: "Adapta.org",
    icon: "auto_awesome",
    color: "#10B981",
    textIcon: "ADW",
    website: "https://agent.adapta.one",
    notice: "Adapta.one session (Clerk auth).",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your __client cookie from agent.adapta.one (Clerk auth)",
  transport: {
    baseUrl: "https://agent.adapta.one/api/chat/stream/v1",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "adapta-one", name: "Adapta ONE (auto)" },
  ],
  passthroughModels: true,
};
