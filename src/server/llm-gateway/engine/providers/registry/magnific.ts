export default {
  id: "magnific",
  alias: "magnific",
  category: "apikey",
  authType: "apikey",
  authHint: "Get API key at https://magnific.com",
  display: {
    name: "Magnific",
    icon: "image",
    color: "#F97316",
    textIcon: "MG",
    website: "https://magnific.com",
    notice: {
      apiKeyUrl: "https://magnific.com",
    },
  },
  transport: {
    auth: { header: "x-magnific-api-key", scheme: "raw", source: ["apiKey"] },
  },
  models: [
    { id: "mystic", name: "Mystic", kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: {
    baseUrl: "https://api.magnific.com/v1/ai/mystic",
    defaultModel: "mystic",
  },
};
