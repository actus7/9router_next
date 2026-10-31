export default {
  id: "doubao",
  alias: "doubao",
  display: {
    name: "Doubao",
    icon: "smart_toy",
    color: "#F43F5E",
    textIcon: "DB",
    website: "https://www.volcengine.com/product/doubao",
    notice: {
      apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    format: "openai",
    validateUrl: "https://ark.cn-beijing.volces.com/api/v3/models",
  },
};
