export default {
  id: "soniox",
  alias: "soniox",
  display: {
    name: "Soniox",
    icon: "mic",
    color: "#6366F1",
    textIcon: "SX",
    website: "https://soniox.com",
    notice: {
      apiKeyUrl: "https://soniox.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.soniox.com/v1/audio/transcriptions",
  },
  models: [
    { id: "soniox", name: "Soniox", kind: "stt" },
  ],
  serviceKinds: ["stt"],
  sttConfig: {
    baseUrl: "https://api.soniox.com/v1/audio/transcriptions",
    authType: "apikey",
    authHeader: "bearer",
    format: "openai",
  },
};
