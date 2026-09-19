export default {
  id: "nanobanana",
  priority: 80,
  hasFree: true,
  alias: "nanobanana",
  aliases: [
    "nb",
  ],
  uiAlias: "nb",
  display: {
    name: "NanoBanana API",
    icon: "extension",
    color: "#FFD700",
    textIcon: "🍌",
    website: "https://nanobananaapi.ai",
    notice: {
      text: "3rd-party proxy for Google Nano Banana (Gemini 2.5/3 Flash Image). For official, use Gemini provider.",
      apiKeyUrl: "https://nanobananaapi.ai/dashboard",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.nanobananaapi.ai/v1/chat/completions",
    validateUrl: "https://api.nanobananaapi.ai/v1/models",
  },
    modelOverrides: {
    "nanobanana-flash": { "params": ["n", "size"], "kind": "image" },
    "nanobanana-pro": { "params": ["n", "size"], "kind": "image" },
  },
  serviceKinds: ["image"],
  imageConfig: {
    baseUrl: "https://api.nanobananaapi.ai/api/v1/nanobanana/generate",
    pollUrl: "https://api.nanobananaapi.ai/api/v1/nanobanana/record-info",
  },
};
