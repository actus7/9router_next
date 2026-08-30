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
    website: "https://adapta.org",
    notice: "Adapta.org session.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your __client cookie from adapta.org (Clerk auth)",
  transport: {
    baseUrl: "https://adapta.org/api/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "adapta-default", name: "Adapta Default" },
  ],
  passthroughModels: true,
};
