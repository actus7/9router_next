export default {
  id: "meta-llama",
  alias: "meta",
  display: {
    name: "Meta Llama",
    icon: "bolt",
    color: "#0081FB",
    textIcon: "ML",
    website: "https://llama.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.llama.com/compat/v1/chat/completions",
    format: "openai",
  },
};
