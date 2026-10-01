export default {
  id: "opencode-go",
  priority: 210,
  alias: "opencode-go",
  aliases: [
    "ocg",
  ],
  uiAlias: "ocg",
  display: {
    name: "OpenCode Go",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    website: "https://opencode.ai/auth",
    notice: {
      text: "OpenCode Go subscription: $5/mo (then  0/mo). Access to Kimi, GLM, Qwen, MiMo, MiniMax models.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
    headers: {},
  },
  // Multi-endpoint: pick the transport matching the client sourceFormat to skip
  // translation. Guarded per-model by `supportedFormats` (see chatCore) because
  // opencode-go models differ in endpoint support.
  transports: [
    { format: "openai", baseUrl: "https://opencode.ai/zen/go/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
    { format: "claude", baseUrl: "https://opencode.ai/zen/go/v1/messages", auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true } },
    { format: "openai-responses", baseUrl: "https://opencode.ai/zen/go/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ],
  // Discovered catalogue (see PROVIDER_MODELS_CONFIG — /zen/go/v1/models answers
  // a live OpenAI listing). Per-model transport metadata lives in modelOverrides:
  // `supportedFormats` guards the sourceFormat-matched transport because
  // opencode-go models differ in endpoint support (kimi/glm only do
  // /chat/completions, minimax/qwen also do /messages, deepseek also does
  // /responses). Undeclared models keep the upstream default.
  modelOverrides: {
    "glm-5.2": { name: "GLM 5.2", supportedFormats: ["openai"] },
    "glm-5.1": { name: "GLM 5.1", supportedFormats: ["openai"] },
    "kimi-k2.7-code": { name: "Kimi K2.7 Code", supportedFormats: ["openai"] },
    "kimi-k2.6": { name: "Kimi K2.6", supportedFormats: ["openai"] },
    "deepseek-v4-pro": { name: "DeepSeek V4 Pro", supportedFormats: ["openai", "claude", "openai-responses"] },
    "deepseek-v4-flash": { name: "DeepSeek V4 Flash", supportedFormats: ["openai", "claude", "openai-responses"] },
    "mimo-v2.5": { name: "MiMo V2.5", supportedFormats: ["openai"] },
    "mimo-v2.5-pro": { name: "MiMo V2.5 Pro", supportedFormats: ["openai"] },
    "minimax-m3": { name: "MiniMax M3", supportedFormats: ["openai", "claude"] },
    "minimax-m2.7": { name: "MiniMax M2.7", supportedFormats: ["openai", "claude"] },
    "minimax-m2.5": { name: "MiniMax M2.5", supportedFormats: ["openai", "claude"] },
    "qwen3.7-max": { name: "Qwen 3.7 Max", supportedFormats: ["openai", "claude"] },
    "qwen3.7-plus": { name: "Qwen 3.7 Plus", supportedFormats: ["openai", "claude"] },
    "qwen3.6-plus": { name: "Qwen 3.6 Plus", supportedFormats: ["openai", "claude"] },
  },
};
