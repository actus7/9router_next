export default {
  id: "tencent-aistudio-web",
  alias: "tas",
  aliases: ["tencent-aistudio-web"],
  uiAlias: "tas",
  display: {
    name: "Tencent AI Studio (Free)",
    icon: "auto_awesome",
    color: "#07C160",
    textIcon: "TAS",
    website: "https://aistudio.tencent.com",
    notice: "Free Tencent AI Studio.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your session cookie from aistudio.tencent.ai",
  transport: {
    baseUrl: "https://aistudio.tencent.com/api/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "tencent-aistudio-default", name: "Tencent AI Studio Default" },
  ],
  passthroughModels: true,
};
