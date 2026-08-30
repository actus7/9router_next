export default {
  id: "chatgpt-web-codex",
  priority: 150,
  alias: "cwc",
  aliases: [
    "cwc",
  ],
  uiAlias: "cwc",
  display: {
    name: "ChatGPT Web Codex",
    icon: "auto_awesome",
    color: "#10A37F",
    textIcon: "CWC",
    website: "https://chatgpt.com",
    notice: "ChatGPT Web with native tool calling. Cookies expire — re-paste when needed.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your full cookie header from chatgpt.com",
  transport: {
    baseUrl: "https://chatgpt.com/backend-api/codex/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
  ],
  passthroughModels: true,
};
