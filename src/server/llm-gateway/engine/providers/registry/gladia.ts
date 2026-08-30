export default {
  id: "gladia",
  alias: "gladia",
  display: {
    name: "Gladia",
    icon: "mic",
    color: "#F97316",
    textIcon: "GL",
    website: "https://gladia.io",
    notice: {
      apiKeyUrl: "https://gladia.io",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.gladia.io/v2/transcription",
  },
  models: [
    { id: "gladia", name: "Gladia", kind: "stt" },
  ],
  serviceKinds: ["stt"],
  sttConfig: {
    baseUrl: "https://api.gladia.io/v2/transcription",
    authType: "apikey",
    authHeader: "bearer",
    format: "openai",
  },
};
