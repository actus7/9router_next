export default {
  id: "xquik-search",
  alias: "xquik",
  display: {
    name: "XQuik Search",
    icon: "search",
    color: "#EF4444",
    textIcon: "XQ",
    website: "https://xquik.com",
    notice: {
      text: "Get API key at https://xquik.com — keys start with xq_",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.xquik.com/v1/search",
  },
  models: [
    { id: "xquik", name: "XQuik" },
  ],
  serviceKinds: ["webSearch"],
  searchViaChat: {
    defaultModel: "xquik",
    endpoint: "https://api.xquik.com/v1/search",
  },
};
