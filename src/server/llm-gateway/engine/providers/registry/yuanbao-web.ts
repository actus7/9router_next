export default {
  id: "yuanbao-web",
  alias: "yw",
  aliases: ["yuanbao-web"],
  uiAlias: "yw",
  display: {
    name: "Tencent Yuanbao (Free)",
    icon: "auto_awesome",
    color: "#0052D9",
    textIcon: "YW",
    website: "https://yuanbao.tencent.com",
    notice: "Free Tencent Yuanbao (DeepSeek/Hunyuan).",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your hy_user and hy_token cookies from yuanbao.tencent.com",
  transport: {
    baseUrl: "https://yuanbao.tencent.com/api/chat/completions",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "yuanbao-default", name: "Yuanbao Default" },
  ],
  passthroughModels: true,
};
