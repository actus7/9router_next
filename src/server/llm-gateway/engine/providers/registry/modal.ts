export default {
  id: "modal",
  alias: "modal",
  display: {
    name: "Modal AI",
    icon: "cloud",
    color: "#000000",
    textIcon: "MO",
    website: "https://modal.com",
    notice: {
      text: "Modal AI. Configure app URL.",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://{app}.modal.run/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "modal-llama-3-3-70b", name: "Modal Llama 3.3 70B" },
  ],
};
