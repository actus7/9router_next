export default {
  id: "speechmatics",
  alias: "speechmatics",
  display: {
    name: "Speechmatics",
    icon: "mic",
    color: "#059669",
    textIcon: "SM",
    website: "https://speechmatics.com",
    notice: {
      text: "8h/mês grátis",
      apiKeyUrl: "https://speechmatics.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://asr.api.speechmatics.com/v2/jobs",
  },
  models: [
    { id: "speechmatics", name: "Speechmatics", kind: "stt" },
  ],
  serviceKinds: ["stt"],
  sttConfig: {
    baseUrl: "https://asr.api.speechmatics.com/v2/jobs",
    authType: "apikey",
    authHeader: "bearer",
    format: "openai",
  },
};
