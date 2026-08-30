export default {
  id: "maritalk",
  alias: "maritalk",
  display: {
    name: "Maritaca AI",
    icon: "bolt",
    color: "#0EA5E9",
    textIcon: "MT",
    website: "https://maritaca.ai",
    notice: {
      apiKeyUrl: "https://chat.maritaca.ai/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://chat.maritaca.ai/api/chat/completions",
    format: "openai",
    auth: { header: "Authorization", scheme: "key", source: ["apiKey"] },
  },
  models: [
    { id: "sabia-4", name: "Sabiá 4" },
    { id: "sabia-4-thinking", name: "Sabiá 4 Thinking" },
    { id: "sabiazinho-4", name: "Sabiazinho 4" },
  ],
};
