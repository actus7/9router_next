export default {
  id: "ovh",
  alias: "ovh",
  display: {
    name: "OVH AI Endpoints",
    icon: "cloud",
    color: "#00008B",
    textIcon: "OVH",
    website: "https://endpoints.ai.cloud.ovh.net",
    notice:
      "Keyless anonymous access — 2 req/min per IP per model (no card needed). Authenticated mode (400 req/min) requires a Public Cloud project. Models may be deprecated on notice.",
  },
  category: "free",
  noAuth: true,
  authHint: "No API key needed for anonymous access. Authenticated keys require an OVH Public Cloud project.",
  transport: {
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    format: "openai",
    noAuth: true,
    validateUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models",
  },
  modelsFetcher: { url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models", type: "openai" },
  models: [
    { id: "gpt-oss-120b", name: "GPT-OSS 120B (OVH)" },
    { id: "Meta-Llama-3_3-70B-Instruct", name: "Llama 3.3 70B Instruct (OVH)" },
    { id: "Mistral-Nemo-Instruct-2407", name: "Mistral Nemo Instruct 2407 (OVH)" },
  ],
};
