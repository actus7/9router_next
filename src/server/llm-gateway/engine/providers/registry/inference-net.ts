export default {
  id: "inference-net",
  alias: "inet",
  display: {
    name: "Inference.net",
    icon: "bolt",
    color: "#F59E0B",
    textIcon: "IN",
    website: "https://inference.net",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.inference.net/v1/chat/completions",
    format: "openai",
  },
};
