import {
  createArkModelsConfig,
  createOpenAIModelsConfig,
  parseGeminiModels,
  parseOpenAIStyleModels,
  parsePollinationsModels,
} from "./providerModelsParsers";
import { PROVIDER_MODELS_CUSTOM_RESOLVERS } from "./providerModelsCustomResolvers";

const PROVIDER_MODELS_STATIC_ENTRIES: Record<string, Record<string, unknown>> = {
  claude: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json"
    },
    authHeader: "x-api-key",
    parseResponse: (data: Record<string, unknown>) => data.data || []
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authQuery: "key",
    parseResponse: parseGeminiModels
  },
  github: {
    url: "https://api.githubcopilot.com/models",
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Copilot-Integration-Id": "vscode-chat",
      "editor-version": "vscode/1.107.1",
      "editor-plugin-version": "copilot-chat/0.26.7",
      "user-agent": "GitHubCopilotChat/0.26.7"
    },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: Record<string, unknown>) => {
      if (!data?.data) return [];
      return (data.data as Record<string, unknown>[])
        .filter(m => (m.capabilities as Record<string, unknown>)?.type === "chat")
        .filter(m => (m.policy as Record<string, unknown>)?.state !== "disabled")
        .map(m => ({
          id: m.id,
          name: m.name || m.id,
          version: m.version,
          capabilities: m.capabilities,
          isDefault: m.model_picker_enabled === true
        }));
    }
  },
  openai: createOpenAIModelsConfig("https://api.openai.com/v1/models"),
  "opencode-go": createOpenAIModelsConfig("https://opencode.ai/zen/go/v1/models"),
  glm: createOpenAIModelsConfig("https://api.z.ai/api/coding/paas/v4/models"),
  openrouter: createOpenAIModelsConfig("https://openrouter.ai/api/v1/models"),
  "api-airforce": createOpenAIModelsConfig("https://api.airforce/v1/models"),
  "kilo-gateway": createOpenAIModelsConfig("https://api.kilo.ai/api/gateway/models"),
  poolside: createOpenAIModelsConfig("https://inference.poolside.ai/v1/models"),
  "naga-ac": createOpenAIModelsConfig("https://api.naga.ac/v1/models"),
  aihorde: createOpenAIModelsConfig("https://oai.aihorde.net/v1/models"),
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json"
    },
    authHeader: "x-api-key",
    parseResponse: (data: Record<string, unknown>) => data.data || []
  },
  alicode: {
    url: "https://coding.dashscope.aliyuncs.com/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: Record<string, unknown>) => data.data || []
  },
  "alicode-intl": {
    url: "https://coding-intl.dashscope.aliyuncs.com/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: Record<string, unknown>) => data.data || []
  },
  "alims-intl": {
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: Record<string, unknown>) => data.data || []
  },
  "alitp-intl": createOpenAIModelsConfig("https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/models"),
  "volcengine-ark": createArkModelsConfig("https://ark.cn-beijing.volces.com/api/coding/v3/models"),
  byteplus: createArkModelsConfig("https://ark.ap-southeast.bytepluses.com/api/v3/models"),
  deepseek: createOpenAIModelsConfig("https://api.deepseek.com/models"),
  groq: createOpenAIModelsConfig("https://api.groq.com/openai/v1/models"),
  xai: createOpenAIModelsConfig("https://api.x.ai/v1/models"),
  mistral: createOpenAIModelsConfig("https://api.mistral.ai/v1/models"),
  perplexity: createOpenAIModelsConfig("https://api.perplexity.ai/v1/models"),
  "perplexity-agent": createOpenAIModelsConfig("https://api.perplexity.ai/v1/models"),
  together: createOpenAIModelsConfig("https://api.together.xyz/v1/models"),
  fireworks: createOpenAIModelsConfig("https://api.fireworks.ai/inference/v1/models"),
  cerebras: createOpenAIModelsConfig("https://api.cerebras.ai/v1/models"),
  cohere: createOpenAIModelsConfig("https://api.cohere.ai/v1/models"),
  nebius: createOpenAIModelsConfig("https://api.studio.nebius.ai/v1/models"),
  siliconflow: createOpenAIModelsConfig("https://api.siliconflow.com/v1/models"),
  hyperbolic: createOpenAIModelsConfig("https://api.hyperbolic.xyz/v1/models"),
  ollama: {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: parseOpenAIStyleModels,
  },
  nanobanana: createOpenAIModelsConfig("https://api.nanobananaapi.ai/v1/models"),
  chutes: createOpenAIModelsConfig("https://llm.chutes.ai/v1/models"),
  nvidia: createOpenAIModelsConfig("https://integrate.api.nvidia.com/v1/models"),
  assemblyai: createOpenAIModelsConfig("https://api.assemblyai.com/v1/models"),
  "vercel-ai-gateway": createOpenAIModelsConfig("https://ai-gateway.vercel.sh/v1/models"),

  // Moved off a shipped list on 2026-10-31. Public listings (answered 200
  // without a key): bazaarlink … typhoon, pollinations.
  bazaarlink: createOpenAIModelsConfig("https://bazaarlink.ai/api/v1/models"),
  cline: createOpenAIModelsConfig("https://api.cline.bot/api/v1/models"),
  clinepass: createOpenAIModelsConfig("https://api.cline.bot/api/v1/models"),
  deepinfra: createOpenAIModelsConfig("https://api.deepinfra.com/v1/openai/models"),
  "free-ai": createOpenAIModelsConfig("https://api.free.ai/v1/models"),
  "inference-net": createOpenAIModelsConfig("https://api.inference.net/v1/models"),
  llm7: createOpenAIModelsConfig("https://api.llm7.io/v1/models"),
  modelscope: createOpenAIModelsConfig("https://api-inference.modelscope.cn/v1/models"),
  "nous-research": createOpenAIModelsConfig("https://inference-api.nousresearch.com/v1/models"),
  opengateway: createOpenAIModelsConfig("https://opengateway.gitlawb.com/v1/models"),
  poe: createOpenAIModelsConfig("https://api.poe.com/v1/models"),
  sambanova: createOpenAIModelsConfig("https://api.sambanova.ai/v1/models"),
  sarvam: createOpenAIModelsConfig("https://api.sarvam.ai/v1/models"),
  typhoon: createOpenAIModelsConfig("https://api.opentyphoon.ai/v1/models"),
  pollinations: { ...createOpenAIModelsConfig("https://gen.pollinations.ai/v1/models"), parseResponse: parsePollinationsModels },
  // Key-gated listings: `/models` answers 401/403 without a key where an
  // unknown path on the same host answers 404, so the route exists.
  "360ai": createOpenAIModelsConfig("https://api.360.cn/v1/models"),
  ai21: createOpenAIModelsConfig("https://api.ai21.com/studio/v1/models"),
  "ant-ling": createOpenAIModelsConfig("https://api.ant-ling.com/v1/models"),
  baichuan: createOpenAIModelsConfig("https://api.baichuan-ai.com/v1/models"),
  baidu: createOpenAIModelsConfig("https://qianfan.baidubce.com/v2/models"),
  baseten: createOpenAIModelsConfig("https://inference.baseten.co/v1/models"),
  bluesminds: createOpenAIModelsConfig("https://api.bluesminds.com/v1/models"),
  internlm: createOpenAIModelsConfig("https://chat.intern-ai.org.cn/api/v1/models"),
  kimi: createOpenAIModelsConfig("https://api.kimi.com/coding/v1/models"),
  "kimi-coding-apikey": createOpenAIModelsConfig("https://api.kimi.com/coding/v1/models"),
  liquid: createOpenAIModelsConfig("https://inference.liquid.ai/v1/models"),
  maritalk: createOpenAIModelsConfig("https://chat.maritaca.ai/api/models"),
  "meta-llama": createOpenAIModelsConfig("https://api.llama.com/compat/v1/models"),
  moonshot: createOpenAIModelsConfig("https://api.moonshot.ai/v1/models"),
  plamo: createOpenAIModelsConfig("https://api.platform.preferredai.jp/v1/models"),
  publicai: createOpenAIModelsConfig("https://api.publicai.co/v1/models"),
  "qwen-cloud-token-plan": createOpenAIModelsConfig("https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/models"),
  sensenova: createOpenAIModelsConfig("https://token.sensenova.cn/v1/models"),
  stepfun: createOpenAIModelsConfig("https://api.stepfun.com/v1/models"),
  tencent: createOpenAIModelsConfig("https://api.hunyuan.cloud.tencent.com/v1/models"),
  upstage: createOpenAIModelsConfig("https://api.upstage.ai/v1/models"),
  writer: createOpenAIModelsConfig("https://api.writer.com/v1/models"),
  // Same platform as an entry above that already lists (glm, volcengine-ark,
  // byteplus), or a documented OpenAI-compatible `/v1/models` (nscale, wandb).
  "glm-cn": createOpenAIModelsConfig("https://open.bigmodel.cn/api/coding/paas/v4/models"),
  glmt: createOpenAIModelsConfig("https://open.bigmodel.cn/api/paas/v4/models"),
  doubao: createArkModelsConfig("https://ark.cn-beijing.volces.com/api/v3/models"),
  "volcengine-agent-plan": createArkModelsConfig("https://ark.cn-beijing.volces.com/api/coding/v3/models"),
  "volcengine-coding-plan": createArkModelsConfig("https://ark.ap-southeast.bytepluses.com/api/coding/v3/models"),
  nscale: createOpenAIModelsConfig("https://inference.api.nscale.com/v1/models"),
  wandb: createOpenAIModelsConfig("https://api.inference.wandb.ai/v1/models"),
  // Pioneer's API host moved to Fastino; the listing is public, the key rides x-api-key.
  pioneer: { ...createOpenAIModelsConfig("https://api.fastino.ai/v1/models"), authHeader: "x-api-key", authPrefix: "" },
};

export const PROVIDER_MODELS_CONFIG: Record<string, Record<string, unknown>> = {
  ...PROVIDER_MODELS_STATIC_ENTRIES,
  ...PROVIDER_MODELS_CUSTOM_RESOLVERS,
};
