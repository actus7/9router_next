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
    notice: "Microsoft Copilot Web session. WebSocket protocol — anonymous access has limited turns.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your access_token from copilot.microsoft.com (optional — anonymous access works with limited turns)",
  transport: {
    baseUrl: "https://copilot.microsoft.com/c/api/start",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "copilot", name: "Copilot" },
    { id: "copilot-think-deeper", name: "Copilot Think Deeper" },
    { id: "copilot-gpt5", name: "Copilot (GPT-5)" },
  ],
  passthroughModels: true,
};
