export default {
  id: "v0-vercel",
  alias: "v0",
  category: "apikey",
  authType: "apikey",
  display: {
    name: "v0 (Vercel)",
    icon: "code",
    color: "#000000",
    textIcon: "V0",
    website: "https://v0.dev",
    notice: {
      apiKeyUrl: "https://v0.dev",
    },
  },
  transport: {
    baseUrl: "https://api.v0.dev/v1/chat/completions",
  },
  models: [
    { id: "v0-default", name: "v0 Default" },
  ],
};
