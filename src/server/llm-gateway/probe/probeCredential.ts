import { getDefaultModel, PROVIDERS } from "@/server/llm-gateway/catalog";
import {
  CREDENTIAL_REJECTED_STATUSES,
  probeFailed,
  probeOk,
  type MaybeProbeResult,
  type ProbeResult,
} from "./types";

/**
 * Sending a probe is the caller's job: the test route goes through the
 * connection proxy, the validate route through the SSRF-guarded fetch. The
 * engine only decides what to send and how to read the answer.
 */
export type ProbeFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * How to ask one provider whether a credential works. Five shapes cover every
 * provider that used to carry its own hand-written request builder.
 */
export type ProbeStrategy =
  | "bearer-get"      // GET a listing URL with an Authorization header
  | "custom-prefix"   // same, with a non-Bearer scheme such as Token or Key
  | "query-key"       // GET with the key in the query string
  | "chat-post"       // POST a one-token chat completion
  | "anthropic-post"; // POST /v1/messages with x-api-key

export interface ProbePlan {
  strategy: ProbeStrategy;
  url: string;
  /** Model for the strategies that send a body. */
  model?: string;
  /** Auth scheme prefix, including its trailing space. Defaults to "Bearer ". */
  authPrefix?: string;
  /** Send the key as X-API-Key instead of an Authorization header. */
  apiKeyHeader?: boolean;
  extraHeaders?: Record<string, string>;
  /** Statuses that mean the credential was refused. Defaults to 401 and 403. */
  rejected?: ReadonlySet<number>;
  /** Operator-facing message when the credential is refused. */
  error?: string;
  /** Skip the connection proxy. Only providers that reject proxied IPs need this. */
  direct?: boolean;
}

const REJECTED_KEY = "Invalid API key";
const REJECT_401_ONLY: ReadonlySet<number> = new Set([401]);

/**
 * Per-provider probe declarations.
 *
 * `url` is resolved registry-first: the entry's literal is a documented
 * fallback for when the registry declares no `validateUrl`, which is the same
 * belt-and-braces pattern the old code used inline. Every entry here used to be
 * a separate request builder or switch arm.
 */
const PLANS: Record<string, ProbePlan> = {
  // Bearer GET on a listing endpoint.
  openai: { strategy: "bearer-get", url: "https://api.openai.com/v1/models" },
  "vercel-ai-gateway": { strategy: "bearer-get", url: "https://ai-gateway.vercel.sh/v1/models" },
  deepseek: { strategy: "bearer-get", url: "https://api.deepseek.com/models" },
  groq: { strategy: "bearer-get", url: "https://api.groq.com/openai/v1/models" },
  mistral: { strategy: "bearer-get", url: "https://api.mistral.ai/v1/models" },
  xai: { strategy: "bearer-get", url: "https://api.x.ai/v1/models" },
  nvidia: { strategy: "bearer-get", url: "https://integrate.api.nvidia.com/v1/models" },
  perplexity: { strategy: "bearer-get", url: "https://api.perplexity.ai/v1/models" },
  together: { strategy: "bearer-get", url: "https://api.together.xyz/v1/models" },
  fireworks: { strategy: "bearer-get", url: "https://api.fireworks.ai/inference/v1/models" },
  cerebras: { strategy: "bearer-get", url: "https://api.cerebras.ai/v1/models" },
  cohere: { strategy: "bearer-get", url: "https://api.cohere.ai/v1/models" },
  nebius: { strategy: "bearer-get", url: "https://api.studio.nebius.ai/v1/models" },
  siliconflow: { strategy: "bearer-get", url: "https://api.siliconflow.com/v1/models" },
  hyperbolic: { strategy: "bearer-get", url: "https://api.hyperbolic.xyz/v1/models" },
  nanobanana: { strategy: "bearer-get", url: "https://api.nanobananaapi.ai/v1/models" },
  chutes: { strategy: "bearer-get", url: "https://llm.chutes.ai/v1/models" },
  openrouter: { strategy: "bearer-get", url: "https://openrouter.ai/api/v1/auth/key" },
  assemblyai: { strategy: "bearer-get", url: "https://api.assemblyai.com/v1/account" },
  "xiaomi-mimo": { strategy: "bearer-get", url: "https://api.xiaomimimo.com/v1/models" },
  "xiaomi-tokenplan": { strategy: "bearer-get", url: "https://token-plan-sgp.xiaomimimo.com/v1/models" },
  "kilo-gateway": {
    strategy: "bearer-get",
    url: "https://api.kilo.ai/api/gateway/models",
    extraHeaders: { Accept: "application/json" },
    error: "Kilo Gateway rejected the key",
  },
  "api-airforce": {
    strategy: "bearer-get",
    url: "https://api.airforce/v1/models",
    extraHeaders: { Accept: "application/json", "HTTP-Referer": "https://endpoint-proxy.local", "X-Title": "Endpoint Proxy" },
    error: "Api Airforce rejected the key",
  },
  "naga-ac": { strategy: "bearer-get", url: "https://api.naga.ac/v1/models", error: "Invalid API key or base URL" },
  kimchi: {
    strategy: "bearer-get",
    url: "https://api.cast.ai/v1/llm/openai/supported-providers",
    extraHeaders: { Accept: "application/json", "User-Agent": "kimchi/0.1.40" },
  },

  // Non-Bearer auth schemes.
  ollama: { strategy: "custom-prefix", url: "https://ollama.com/api/tags", authPrefix: "Bearer ", direct: true },
  deepgram: { strategy: "custom-prefix", url: "https://api.deepgram.com/v1/projects", authPrefix: "Token " },
  "fal-ai": { strategy: "custom-prefix", url: "https://api.fal.ai/v1/models?limit=1", authPrefix: "Key " },

  // Key travels in the query string.
  gemini: { strategy: "query-key", url: "https://generativelanguage.googleapis.com/v1/models" },

  // One-token chat completion.
  "glm-cn": { strategy: "chat-post", url: "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions", model: "glm-4.7" },
  alicode: { strategy: "chat-post", url: "https://coding.dashscope.aliyuncs.com/v1/chat/completions" },
  "alicode-intl": { strategy: "chat-post", url: "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions" },
  "alims-intl": { strategy: "chat-post", url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions" },
  "opencode-go": { strategy: "chat-post", url: "https://opencode.ai/zen/go/v1/chat/completions" },
  "volcengine-ark": { strategy: "chat-post", url: "" },
  byteplus: { strategy: "chat-post", url: "" },

  // Anthropic wire format. Anthropic itself still accepts a 403.
  anthropic: { strategy: "anthropic-post", url: "https://api.anthropic.com/v1/messages", model: "claude-3-haiku-20240307", rejected: REJECT_401_ONLY },
  glm: { strategy: "anthropic-post", url: "https://api.z.ai/api/anthropic/v1/messages", model: "glm-4.7" },
  minimax: { strategy: "anthropic-post", url: "https://api.minimax.io/anthropic/v1/messages", model: "minimax-m2" },
  "minimax-cn": { strategy: "anthropic-post", url: "https://api.minimaxi.com/anthropic/v1/messages", model: "minimax-m2" },
  kimi: { strategy: "anthropic-post", url: "https://api.kimi.com/coding/v1/messages", model: "kimi-latest" },
};

/** Providers whose plan is another provider's. */
const PLAN_ALIASES: Record<string, string> = {
  naga: "naga-ac",
  kc: "kilocode",
};

/** The registry owns probe URLs; a plan literal applies only when it declares none. */
function registryUrl(provider: string, fallback: string): string {
  const declared = (PROVIDERS[provider] as Record<string, unknown> | undefined)?.validateUrl;
  return typeof declared === "string" && declared.length > 0 ? declared : fallback;
}

/** Base URL for a chat probe, registry-first. */
function registryChatUrl(provider: string, fallback: string): string {
  const base = (PROVIDERS[provider] as Record<string, unknown> | undefined)?.baseUrl;
  return typeof base === "string" && base.length > 0 ? base : fallback;
}

export function resolveProbePlan(provider: string): ProbePlan | null {
  const key = PLAN_ALIASES[provider] || provider;
  const declared = PLANS[key];
  if (declared) {
    const url = declared.strategy === "chat-post"
      ? registryChatUrl(key, declared.url)
      : registryUrl(key, declared.url);
    return url ? { ...declared, url } : null;
  }

  // No declaration: any OpenAI-format provider in the registry can still be
  // probed generically, which is what the old switch's default arm did.
  const cfg = PROVIDERS[provider] as Record<string, unknown> | undefined;
  if (!cfg || cfg.format !== "openai" || typeof cfg.baseUrl !== "string" || !cfg.baseUrl) return null;
  if (cfg.noAuth === true) return null;

  const listing = typeof cfg.validateUrl === "string" && cfg.validateUrl
    ? cfg.validateUrl
    : cfg.baseUrl.replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models");
  return {
    strategy: "bearer-get",
    url: listing,
    apiKeyHeader: cfg.authHeader === "x-api-key",
    extraHeaders: (cfg.headers as Record<string, string> | undefined) || undefined,
  };
}

export async function runProbePlan(
  provider: string,
  plan: ProbePlan,
  apiKey: string,
  doFetch: ProbeFetch,
): Promise<ProbeResult> {
  const rejected = plan.rejected || CREDENTIAL_REJECTED_STATUSES;
  const error = plan.error || REJECTED_KEY;
  const headers: Record<string, string> = { ...(plan.extraHeaders || {}) };

  switch (plan.strategy) {
    case "bearer-get":
    case "custom-prefix": {
      if (plan.apiKeyHeader) headers["X-API-Key"] = apiKey;
      else headers["Authorization"] = `${plan.authPrefix || "Bearer "}${apiKey}`;
      const res = await doFetch(plan.url, { headers });
      if (rejected.has(res.status)) return probeFailed(error, { status: res.status });
      return res.ok ? probeOk({ status: res.status }) : probeFailed(error, { status: res.status });
    }

    case "query-key": {
      const separator = plan.url.includes("?") ? "&" : "?";
      const res = await doFetch(`${plan.url}${separator}key=${encodeURIComponent(apiKey)}`, {});
      return res.ok ? probeOk({ status: res.status }) : probeFailed(error, { status: res.status });
    }

    case "anthropic-post": {
      const res = await doFetch(plan.url, {
        method: "POST",
        headers: { ...headers, "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: plan.model, max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
      });
      return rejected.has(res.status) ? probeFailed(error, { status: res.status }) : probeOk({ status: res.status });
    }

    default: {
      const res = await doFetch(plan.url, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: plan.model || getDefaultModel(provider) || "test",
          max_tokens: 1,
          messages: [{ role: "user", content: "test" }],
        }),
      });
      return rejected.has(res.status) ? probeFailed(error, { status: res.status }) : probeOk({ status: res.status });
    }
  }
}

/**
 * Probe a credential using the provider's declared plan.
 *
 * Returns null when no plan applies, so the caller falls through to a handler
 * for a provider that genuinely needs bespoke work: one that requires an
 * account id, a token exchange first, or a base URL stored on the connection.
 */
export async function probeCredential(
  provider: string,
  apiKey: string,
  doFetch: ProbeFetch,
): Promise<MaybeProbeResult> {
  const plan = resolveProbePlan(provider);
  if (!plan) return null;
  try {
    return await runProbePlan(provider, plan, apiKey, doFetch);
  } catch (err) {
    return probeFailed((err as Error).message || REJECTED_KEY);
  }
}

export const __test__ = { PLANS, PLAN_ALIASES };
