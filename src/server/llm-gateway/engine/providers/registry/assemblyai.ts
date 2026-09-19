export default {
  id: "assemblyai",
  priority: 30,
  alias: "assemblyai",
  aliases: [
    "aai",
  ],
  uiAlias: "aai",
  display: {
    name: "AssemblyAI",
    icon: "record_voice_over",
    color: "#0062FF",
    textIcon: "AA",
    website: "https://assemblyai.com",
    notice: {
      apiKeyUrl: "https://www.assemblyai.com/app/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.assemblyai.com/v1/audio/transcriptions",
    validateUrl: "https://api.assemblyai.com/v1/account",
  },
    modelOverrides: {
    "universal-3-pro": { "params": ["language"], "kind": "stt" },
    "universal-2": { "params": ["language"], "kind": "stt" },
    "best": { "kind": "stt" },
    "nano": { "kind": "stt" },
  },
  serviceKinds: ["stt"],
  sttConfig: {
    baseUrl: "https://api.assemblyai.com/v2/transcript",
    authType: "apikey",
    authHeader: "authorization",
    format: "assemblyai",
  },
};
