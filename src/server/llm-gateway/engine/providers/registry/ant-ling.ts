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
  models: [
    { id: "Ling-2.6-1T", name: "Ling 2.6 1T" },
    { id: "Ring-2.6-1T", name: "Ring 2.6 1T" },
    { id: "Ling-2.6-flash", name: "Ling 2.6 Flash" },
  ],
};
