// Model Studio Intl — standard DashScope API keys (sk-...), NOT Coding Plan keys.
// Sibling of alicode-intl (Coding Plan). Two key types use two different hosts.
export default {
  id: "alims-intl",
  priority: 11,
  alias: "alims-intl",
  display: {
    name: "Alibaba Studio",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "ALi",
    website: "https://modelstudio.console.alibabacloud.com",
    notice: {
      apiKeyUrl: "https://modelstudio.console.alibabacloud.com/?apiKey=1",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers: {},
    quirks: { preserveCacheControl: true },
  },

};
