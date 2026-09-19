export default {
  id: "alicode",
  priority: 20,
  alias: "alicode",
  display: {
    name: "Alibaba",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "ALi",
    website: "https://bailian.console.aliyun.com",
    notice: {
      apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
    headers: {},
    quirks: { preserveCacheControl: true },
  },

};
