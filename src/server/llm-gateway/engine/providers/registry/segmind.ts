export default {
  id: "segmind",
  alias: "segmind",
  category: "apikey",
  authType: "apikey",
  authHint: "Get API key at https://segmind.com",
  display: {
    name: "Segmind",
    icon: "image",
    color: "#14B8A6",
    textIcon: "SG",
    website: "https://segmind.com",
    notice: {
      apiKeyUrl: "https://segmind.com",
    },
  },
  transport: {
    auth: { header: "x-api-key", scheme: "raw", source: ["apiKey"] },
  },
  models: [
    { id: "ssd-1b", name: "SSD-1B", kind: "image" },
    { id: "sdxl-turbo", name: "SDXL Turbo", kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: {
    baseUrl: "https://api.segmind.com/v1",
    defaultModel: "ssd-1b",
  },
};
