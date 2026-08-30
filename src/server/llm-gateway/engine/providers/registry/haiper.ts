export default {
  id: "haiper",
  alias: "haiper",
  category: "apikey",
  authType: "apikey",
  authHint: "Get API key at https://haiper.ai",
  display: {
    name: "Haiper",
    icon: "videocam",
    color: "#F59E0B",
    textIcon: "HP",
    website: "https://haiper.ai",
    notice: {
      apiKeyUrl: "https://haiper.ai",
    },
  },
  transport: null,
  models: [
    { id: "haiper-2", name: "Haiper 2", kind: "video" },
  ],
  serviceKinds: ["video"],
  videoConfig: {
    baseUrl: "https://api.haiper.ai/v1/video/generations",
    defaultModel: "haiper-2",
  },
};
