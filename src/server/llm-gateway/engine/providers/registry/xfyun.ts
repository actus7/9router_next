export default {
  id: "xfyun",
  alias: "xf",
  display: {
    name: "iFlytek Spark",
    icon: "flash_on",
    color: "#EF4444",
    textIcon: "XF",
    website: "https://xinghuo.xfyun.cn",
    notice: {
      text: "Lite model is free. Signup requires Chinese account. Auth uses APIPassword as Bearer.",
      apiKeyUrl: "https://console.xfyun.cn",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://spark-api-open.xf-yun.com/v1/chat/completions",
    validateUrl: "https://spark-api-open.xf-yun.com/v1/models",
  },
  modelsFetcher: { url: "https://spark-api-open.xf-yun.com/v1/models", type: "openai" },
};
