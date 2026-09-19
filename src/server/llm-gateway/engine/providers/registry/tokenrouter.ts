export default {
  id: "tokenrouter",
  alias: "tokenrouter",
  aliases: ["tr"],
  uiAlias: "tokenrouter",
  display: {
    name: "TokenRouter",
    icon: "hub",
    color: "#0EA5E9",
    textIcon: "TR",
    website: "https://www.tokenrouter.com",
    notice: {
      text: "OpenAI-compatible gateway. 300+ models (OpenAI, Claude, Gemini, Qwen, DeepSeek, Kimi, GLM, dsb).",
      apiKeyUrl: "https://www.tokenrouter.com",
    },
  },
  category: "apikey",
  thinkingConfig: {
    options: ["low", "medium", "high", "xhigh", "max"],
    defaultMode: "high",
  },
  transport: {
    baseUrl: "https://api.tokenrouter.com/v1/chat/completions",
    validateUrl: "https://api.tokenrouter.com/v1/models",
    thinkingFormat: "tokenrouter",
  },
  // Seed snapshot from live /v1/models (120 entries). Latest catalogue is
  // fetched via modelsFetcher; other ids still accepted via passthroughModels.
    modelOverrides: {
    "MiniMax-Hailuo-2.3": { "kind": "video" },
    "bytedance-seed/seedream-4.5": { "kind": "image" },
    "bytedance-seed/seedream-5.0-lite": { "kind": "image" },
    "bytedance-seed/seedream-5.0-pro": { "kind": "image" },
    "happyhorse-1.0-t2v": { "kind": "video" },
    "kling-3.0-turbo": { "kind": "video" },
    "kling-v2-6": { "kind": "video" },
    "kling-v3": { "kind": "video" },
    "kling-v3-omni": { "kind": "video" },
    "openai/gpt-5.4-image-2": { "kind": "image" },
    "openai/gpt-audio": { "kind": "audio" },
    "openai/gpt-audio-mini": { "kind": "audio" },
  },
  serviceKinds: ["llm", "embedding", "image"],
  embeddingConfig: {
    baseUrl: "https://api.tokenrouter.com/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
  },
  imageConfig: {
    baseUrl: "https://api.tokenrouter.com/v1/images/generations",
  },
  modelsFetcher: { url: "https://api.tokenrouter.com/v1/models", type: "openai" },
  passthroughModels: true,
};
