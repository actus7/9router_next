export default {
  id: "gemini-web",
  priority: 150,
  alias: "gmw",
  aliases: [
    "gmw",
  ],
  uiAlias: "gmw",
  display: {
    name: "Gemini Web",
    icon: "auto_awesome",
    color: "#4285F4",
    textIcon: "GMW",
    website: "https://gemini.google.com",
    notice: "Free Gemini Web.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your __Secure-1PSID cookie from gemini.google.com",
  transport: {
    baseUrl: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
  ],
  passthroughModels: true,
};
