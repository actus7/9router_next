export default {
  id: "hcnsec",
  alias: "hcnsec",
  display: {
    name: "HCNSec",
    icon: "bolt",
    color: "#3B82F6",
    textIcon: "HC",
    website: "https://api.hcnsec.cn",
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.hcnsec.cn/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.hcnsec.cn/v1/models",
  },
  modelsFetcher: { url: "https://api.hcnsec.cn/v1/models", type: "openai" },
};
