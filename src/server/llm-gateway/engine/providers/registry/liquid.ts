export default {
  id: "liquid",
  alias: "liquid",
  display: {
    name: "Liquid AI",
    icon: "bolt",
    color: "#14B8A6",
    textIcon: "LQ",
    website: "https://liquid.ai",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.liquid.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "liquid-lfm-40b", name: "Liquid LFM 40B" },
  ],
};
