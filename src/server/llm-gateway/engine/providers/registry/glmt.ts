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
};
