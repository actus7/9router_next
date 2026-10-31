export default {
  id: "ant-ling",
  alias: "ling",
  display: {
    name: "Ant Ling",
    icon: "smart_toy",
    color: "#10B981",
    textIcon: "LG",
    website: "https://www.ant-ling.com",
    notice: {
      apiKeyUrl: "https://www.ant-ling.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.ant-ling.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.ant-ling.com/v1/models",
  },
};
