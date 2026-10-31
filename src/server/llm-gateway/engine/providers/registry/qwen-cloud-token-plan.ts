export default {
  id: "qwen-cloud-token-plan",
  alias: "qct",
  display: {
    name: "Qwen Cloud Token Plan",
    icon: "bolt",
    color: "#FF6A00",
    textIcon: "QT",
    website: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
    notice: {
      apiKeyUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    format: "openai",
  },
};
