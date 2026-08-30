export default {
  id: "nous-research",
  alias: "nous",
  display: {
    name: "Nous Research",
    icon: "bolt",
    color: "#F59E0B",
    textIcon: "NR",
    website: "https://nousresearch.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "Hermes-4-405B", name: "Hermes 4 405B" },
    { id: "Hermes-4-70B", name: "Hermes 4 70B" },
  ],
};
