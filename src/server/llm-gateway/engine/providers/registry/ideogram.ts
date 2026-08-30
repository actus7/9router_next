export default {
  id: "ideogram",
  alias: "ideogram",
  category: "apikey",
  authType: "apikey",
  authHint: "Get API key at https://ideogram.ai",
  display: {
    name: "Ideogram",
    icon: "image",
    color: "#EC4899",
    textIcon: "ID",
    website: "https://ideogram.ai",
    notice: {
      apiKeyUrl: "https://ideogram.ai",
    },
  },
  transport: {
    auth: { header: "Api-Key", scheme: "raw", source: ["apiKey"] },
  },
  models: [
    { id: "V_3", name: "Ideogram V3", kind: "image" },
    { id: "V_2A", name: "Ideogram V2A", kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: {
    baseUrl: "https://api.ideogram.ai/generate",
    defaultModel: "V_3",
  },
};
