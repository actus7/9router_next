export default {
  id: "alicode-intl",
  priority: 10,
  alias: "alicode-intl",
  display: {
    name: "Alibaba Coding",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "ALi",
    website: "https://www.alibabacloud.com/product/coding",
    notice: {
      apiKeyUrl: "https://www.alibabacloud.com/product/coding",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions",
    headers: {},
    quirks: { preserveCacheControl: true },
  },

};
