export default {
  id: "baidu",
  alias: "qianfan",
  aliases: ["qianfan", "ernie", "baidu-qianfan"],
  uiAlias: "qianfan",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  display: {
    name: "Baidu Qianfan",
    icon: "search",
    color: "#2932E1",
    textIcon: "BD",
    website: "https://cloud.baidu.com/product/qianfan.html",
    notice: {
      apiKeyUrl:
        "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application",
    },
  },
  transport: {
    baseUrl: "https://qianfan.baidubce.com/v2/chat/completions",
    validateUrl: "https://qianfan.baidubce.com/v2/models",
  },
};
