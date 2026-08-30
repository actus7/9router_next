export default {
  id: "copilot-m365-web",
  alias: "m365",
  aliases: ["copilot-m365-web"],
  uiAlias: "m365",
  display: {
    name: "Microsoft 365 Copilot",
    icon: "auto_awesome",
    color: "#0078D4",
    textIcon: "M365",
    website: "https://copilot.microsoft.com",
    notice: "M365 Copilot. Token expires ~75min.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your access_token from copilot.microsoft.com (M365 Business Chat)",
  transport: {
    baseUrl: "https://copilot.microsoft.com/api/v1/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "m365-copilot-default", name: "M365 Copilot Default" },
  ],
  passthroughModels: true,
};
