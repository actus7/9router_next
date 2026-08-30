export default {
  id: "deepai",
  alias: "deepai",
  category: "apikey",
  authType: "apikey",
  authHint: "Get API key at https://deepai.org",
  display: {
    name: "DeepAI",
    icon: "image",
    color: "#EF4444",
    textIcon: "DA",
    website: "https://deepai.org",
    notice: {
      apiKeyUrl: "https://deepai.org",
    },
  },
  transport: {
    auth: { header: "api-key", scheme: "raw", source: ["apiKey"] },
  },
  models: [
    { id: "text2img", name: "Text to Image", kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: {
    baseUrl: "https://api.deepai.org/api/text2img",
    defaultModel: "text2img",
  },
};
