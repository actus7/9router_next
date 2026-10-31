export default {
  id: "sensenova",
  alias: "sensenova",
  display: {
    name: "SenseNova",
    icon: "bolt",
    color: "#EF4444",
    textIcon: "SN",
    website: "https://sensenova.cn",
    notice: {
      apiKeyUrl: "https://sensenova.cn",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://token.sensenova.cn/v1/chat/completions",
    format: "openai",
  },
};
