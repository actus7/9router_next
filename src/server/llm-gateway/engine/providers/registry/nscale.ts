export default {
  id: "nscale",
  alias: "nscale",
  display: {
    name: "Nscale",
    icon: "bolt",
    color: "#0D9488",
    textIcon: "NS",
    website: "https://nscale.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.api.nscale.com/v1/chat/completions",
    format: "openai",
  },
};
