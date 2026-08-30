export default {
  id: "digitalocean",
  alias: "doai",
  display: {
    name: "DigitalOcean GenAI",
    icon: "cloud",
    color: "#0080FF",
    textIcon: "DO",
    website: "https://www.digitalocean.com/products/genai-platform",
    notice: {
      text: "DigitalOcean GenAI Platform. Configure agent URL.",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.digitalocean.com/v1/gen-ai/agents/{agent_id}/chat/completions",
    format: "openai",
  },
  models: [
    { id: "do-llama-3-3-70b", name: "Llama 3.3 70B" },
  ],
};
