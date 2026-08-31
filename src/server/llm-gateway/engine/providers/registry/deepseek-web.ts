export default {
  id: "deepseek-web",
  priority: 150,
  alias: "dsw",
  aliases: [
    "dsw",
  ],
  uiAlias: "dsw",
  display: {
    name: "DeepSeek Web",
    icon: "auto_awesome",
    color: "#0066FF",
    textIcon: "DSW",
    website: "https://chat.deepseek.com",
    notice: "DeepSeek Web session. Solves a proof-of-work challenge per request.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your userToken from Local Storage of chat.deepseek.com",
  transport: {
    baseUrl: "https://chat.deepseek.com/api/v0/chat/completion",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-r1", name: "DeepSeek R1" },
  ],
  passthroughModels: true,
};
