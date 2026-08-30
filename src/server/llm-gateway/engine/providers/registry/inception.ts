export default {
  id: "inception",
  alias: "inception",
  display: {
    name: "Inception Labs",
    icon: "bolt",
    color: "#10B981",
    textIcon: "IN",
    website: "https://inceptionlabs.ai",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.inceptionlabs.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "mercury-2", name: "Mercury 2", contextLength: 128000 },
  ],
};
