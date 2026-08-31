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
    website: "https://aistudio.tencent.ai",
    notice: "Free Tencent AI Studio.",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your session cookie from aistudio.tencent.ai",
  transport: {
    baseUrl: "https://aistudio.tencent.ai/api/chat",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "hy3-g", name: "Hunyuan Default" },
    { id: "hunyuan-3d", name: "Hunyuan 3D" },
  ],
  passthroughModels: true,
};
