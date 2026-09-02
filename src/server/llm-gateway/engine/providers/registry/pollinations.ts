export default {
  id: "pollinations",
  alias: "pl",
  display: {
    name: "Pollinations AI",
    icon: "public",
    color: "#10B981",
    textIcon: "PL",
    website: "https://pollinations.ai",
    notice: {
      text: "Shared-capacity API. A Pollinations publishable (pk_) or secret (sk_) key is required for chat completions.",
      apiKeyUrl: "https://enter.pollinations.ai",
    },
  },
  category: "free",
  authType: "apikey",
  transport: {
    baseUrl: "https://gen.pollinations.ai/v1/chat/completions",
    retry: {
      402: { attempts: 1, delayMs: 8000 },
      429: { attempts: 1, delayMs: 5000 },
    },
  },
  // The model catalogue is public, but inference requires a Pollinations key.
  // Keep the curated rows until a model-refresh endpoint is implemented.
  models: [
    { id: "openai", name: "OpenAI (Pollinations)" },
    { id: "openai-fast", name: "OpenAI Fast (Pollinations)" },
    { id: "openai-large", name: "OpenAI Large (Pollinations)" },
    { id: "qwen-coder", name: "Qwen Coder (Pollinations)" },
    { id: "qwen-coder-large", name: "Qwen Coder Large (Pollinations)" },
    { id: "qwen-large", name: "Qwen Large (Pollinations)" },
    { id: "mistral", name: "Mistral (Pollinations)" },
    { id: "mistral-large", name: "Mistral Large (Pollinations)" },
    { id: "deepseek", name: "DeepSeek (Pollinations)" },
    { id: "grok", name: "Grok (Pollinations)" },
    { id: "gemini-flash-lite-3.1", name: "Gemini Flash Lite 3.1 (Pollinations)" },
    { id: "perplexity-fast", name: "Perplexity Fast (Pollinations)" },
    { id: "perplexity-reasoning", name: "Perplexity Reasoning (Pollinations)" },
  ],
  noModelDiscovery: true,
};
