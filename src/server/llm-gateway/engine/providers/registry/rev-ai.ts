export default {
  id: "rev-ai",
  alias: "revai",
  display: {
    name: "Rev AI",
    icon: "mic",
    color: "#1E40AF",
    textIcon: "RV",
    website: "https://rev.ai",
    notice: {
      apiKeyUrl: "https://rev.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.rev.ai/speechtotext/v1/jobs",
  },
  models: [
    { id: "rev-ai", name: "Rev AI", kind: "stt" },
  ],
  serviceKinds: ["stt"],
  sttConfig: {
    baseUrl: "https://api.rev.ai/speechtotext/v1/jobs",
    authType: "apikey",
    authHeader: "bearer",
    format: "openai",
  },
};
