export default {
  id: "publicai",
  alias: "publicai",
  display: {
    name: "PublicAI",
    icon: "bolt",
    color: "#F59E0B",
    textIcon: "PA",
    website: "https://publicai.co",
    notice: {
      apiKeyUrl: "https://publicai.co",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.publicai.co/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "swiss-ai/apertus-70b-instruct", name: "Apertus 70B Instruct" },
    { id: "swiss-ai/Apertus-8B-Instruct-2509", name: "Apertus 8B Instruct" },
    { id: "aisingapore/Qwen-SEA-LION-v4-32B-IT", name: "Qwen SEA-LION v4 32B" },
    { id: "aisingapore/Gemma-SEA-LION-v4-27B-IT", name: "Gemma SEA-LION v4 27B" },
    { id: "allenai/Olmo-3-32B-Think", name: "OLMo 3 32B Think" },
    { id: "utter-project/EuroLLM-22B-Instruct-2512", name: "EuroLLM 22B Instruct" },
  ],
};
