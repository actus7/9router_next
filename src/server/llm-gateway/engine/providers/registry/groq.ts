export default {
  id: "groq",
  priority: 60,
  hasFree: true,
  alias: "groq",
  display: {
    name: "Groq",
    icon: "speed",
    color: "#F55036",
    textIcon: "GQ",
    website: "https://groq.com",
    notice: {
      apiKeyUrl: "https://console.groq.com/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    validateUrl: "https://api.groq.com/openai/v1/models",
  },
    modelOverrides: {
    "whisper-large-v3": { "params": ["language", "response_format", "temperature", "prompt"], "kind": "stt" },
    "whisper-large-v3-turbo": { "params": ["language", "response_format", "temperature", "prompt"], "kind": "stt" },
    "distil-whisper-large-v3-en": { "params": ["language", "response_format", "temperature", "prompt"], "kind": "stt" },
  },
  serviceKinds: ["llm","imageToText","stt"],
  sttConfig: {
    baseUrl: "https://api.groq.com/openai/v1/audio/transcriptions",
    authType: "apikey",
    authHeader: "bearer",
    format: "openai",
  },
};
