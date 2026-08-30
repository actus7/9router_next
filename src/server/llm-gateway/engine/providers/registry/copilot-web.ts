export default {
  id: "copilot-web",
  priority: 150,
  alias: "cpw",
  aliases: [
    "cpw",
  ],
  uiAlias: "cpw",
  display: {
    name: "Copilot Web",
    icon: "auto_awesome",
    color: "#0078D4",
    textIcon: "CPW",
    website: "https://copilot.microsoft.com",
    notice: "Microsoft Copilot Web session.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your access_token from copilot.microsoft.com",
  transport: {
    baseUrl: "https://copilot.microsoft.com/api/v1/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "copilot-default", name: "Copilot Default" },
  ],
  passthroughModels: true,
};
