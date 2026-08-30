export default {
  id: "zai-web",
  alias: "zaiw",
  aliases: ["zai-web", "zaiw"],
  uiAlias: "zai",
  display: {
    name: "Z.ai Web",
    icon: "language",
    color: "#EF4444",
    textIcon: "ZA",
    website: "https://chat.z.ai",
    notice: "Z.ai Web session. CAPTCHA may be handled by browser transport.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your token from Local Storage of chat.z.ai",
  transport: {
    baseUrl: "https://chat.z.ai/api/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "zai-default", name: "Z.ai Default" },
  ],
};
