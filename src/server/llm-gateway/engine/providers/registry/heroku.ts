export default {
  id: "heroku",
  alias: "heroku",
  display: {
    name: "Heroku AI",
    icon: "cloud",
    color: "#430098",
    textIcon: "HK",
    website: "https://www.heroku.com/ai",
    notice: {
      text: "Heroku AI. Configure app URL.",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.heroku.com/ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "heroku-llama-3-3-70b", name: "Heroku Llama 3.3 70B" },
  ],
};
