export default {
  id: "modelscope",
  alias: "mdl",
  aliases: ["model-scope"],
  uiAlias: "mdl",
  display: {
    name: "ModelScope",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "MS",
    website: "https://modelscope.cn",
    notice: {
      text: "Requires Alibaba Cloud CN account with real-name verification. Free daily quota (魔粒).",
      apiKeyUrl: "https://modelscope.cn/my/myaccesstoken",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api-inference.modelscope.cn/v1/chat/completions",
    validateUrl: "https://api-inference.modelscope.cn/v1/models",
    timeoutMs: 90000,
  },
};
