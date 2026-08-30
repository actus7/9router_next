export default {
  id: "venice-web",
  alias: "vw",
  aliases: ["venice-web"],
  uiAlias: "vw",
  display: {
    name: "Venice Web",
    icon: "auto_awesome",
    color: "#8B5CF6",
    textIcon: "VW",
    website: "https://venice.ai",
    notice: "Privacy-focused Venice Web session.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your session cookie from venice.ai",
  transport: {
    baseUrl: "https://venice.ai/api/v1/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "venice-default", name: "Venice Default" },
  ],
  passthroughModels: true,
};
