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
    website: "https://m365.cloud.microsoft/chat",
    notice: "M365 Copilot. WebSocket protocol (BizChat/Substrate). Token expires ~75min — re-paste on expiry.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste 'access_token=<token>; chathubPath=<user-oid>@<tenant-id>' — capture both from m365.cloud.microsoft/chat DevTools (Network → WS → Chathub request)",
  transport: {
    baseUrl: "wss://substrate.office.com/m365Copilot/Chathub",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "copilot-m365", name: "M365 Copilot" },
    { id: "copilot-m365-claude-opus", name: "M365 Copilot (Claude Opus)" },
    { id: "copilot-m365-gpt-5-6-reasoning", name: "M365 Copilot (GPT-5.6 Reasoning)" },
    { id: "copilot-m365-gpt-5-5-chat", name: "M365 Copilot (GPT-5.5 Chat)" },
  ],
  passthroughModels: true,
};
