export default {
  id: "leonardo",
  alias: "leonardo",
  category: "apikey",
  authType: "apikey",
  authHint: "Get API key at https://leonardo.ai",
  display: {
    name: "Leonardo AI",
    icon: "image",
    color: "#8B5CF6",
    textIcon: "LN",
    website: "https://leonardo.ai",
    notice: {
      apiKeyUrl: "https://leonardo.ai",
    },
  },
  transport: null,
  models: [
    { id: "leonardo-phoenix", name: "Leonardo Phoenix", kind: "image" },
    { id: "leonardo-sdxl", name: "Leonardo SDXL", kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: {
    baseUrl: "https://cloud.leonardo.ai/api/rest/v1/generations",
    defaultModel: "leonardo-phoenix",
  },
};
