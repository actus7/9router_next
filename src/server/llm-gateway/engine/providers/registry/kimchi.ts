export default {
  id: "kimchi",
  priority: 95,
  alias: "kimchi",
  uiAlias: "kimchi",
  display: {
    name: "Kimchi",
    icon: "restaurant",
    color: "#FF521D",
    textIcon: "KC",
    website: "https://kimchi.dev",
    notice: {
      signupUrl: "https://app.kimchi.dev",
    },
  },
  category: "freeTier",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://llm.kimchi.dev/openai/v1/chat/completions",
    format: "openai",
    headers: {
      "User-Agent": "kimchi/0.1.50",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },

  serviceKinds: ["llm", "imageToText"],
  oauth: {
    webAppUrl: "https://app.kimchi.dev",
    validationUrl: "https://api.cast.ai/v1/llm/openai/supported-providers",
    userInfoUrl: "https://app.kimchi.dev/api/v1/me",
    modelsUrl: "https://llm.kimchi.dev/v1/models/metadata?include_in_cli=true",
  },
  passthroughModels: true,
};
