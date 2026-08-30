export default {
  id: "glmt",
  alias: "glmt",
  category: "apikey",
  display: {
    name: "GLMT (Zhipu BigModel)",
    icon: "smart_toy",
    color: "#2B6CB0",
    textIcon: "GL",
    website: "https://open.bigmodel.cn",
    notice: {
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    },
  },
  transport: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    format: "openai",
  },
  models: [
    { id: "GLM-4-Plus", name: "GLM-4-Plus" },
    { id: "GLM-4-0520", name: "GLM-4-0520" },
    { id: "GLM-4-Air", name: "GLM-4-Air" },
    { id: "GLM-4-AirX", name: "GLM-4-AirX" },
    { id: "GLM-4-Flash", name: "GLM-4-Flash" },
    { id: "GLM-4-Long", name: "GLM-4-Long" },
  ],
};
