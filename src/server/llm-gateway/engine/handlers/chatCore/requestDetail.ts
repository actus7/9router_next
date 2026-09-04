import { saveRequestUsage } from "../../host/usage";
import { COLORS } from "../../utils/stream";
import { canonicalizeUsage } from "../../utils/usageTracking";
import { getRoutingDecision } from "../../services/smart-routing/context";
import type { RequestDetailBase, RequestDetailOverrides, SaveUsageStatsOptions } from "./types";

const OPTIONAL_PARAMS = [
  "temperature", "top_p", "top_k",
  "max_tokens", "max_completion_tokens",
  "thinking", "reasoning", "enable_thinking",
  "presence_penalty", "frequency_penalty",
  "seed", "stop", "tools", "tool_choice",
  "response_format", "prediction", "store", "metadata",
  "n", "logprobs", "top_logprobs", "logit_bias",
  "user", "parallel_tool_calls"
];

export function extractRequestConfig(body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  const config: Record<string, unknown> = { messages: body.messages || [], model: body.model, stream };
  for (const param of OPTIONAL_PARAMS) {
    if (body[param] !== undefined) config[param] = body[param];
  }
  const routing = getRoutingDecision(body);
  if (routing) config.routing = routing;
  return config;
}

export function extractUsageFromResponse(responseBody: Record<string, unknown>): Record<string, unknown> | null {
  if (!responseBody || typeof responseBody !== "object") return null;

  // Claude format
  const usage = responseBody.usage as Record<string, unknown> | undefined;
  if (usage?.input_tokens !== undefined) {
    return {
      prompt_tokens: usage.input_tokens || 0,
      completion_tokens: usage.output_tokens || 0,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens
    };
  }

  // OpenAI format
  if (usage?.prompt_tokens !== undefined) {
    return {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      cached_tokens: (usage.prompt_tokens_details as Record<string, unknown>)?.cached_tokens,
      reasoning_tokens: (usage.completion_tokens_details as Record<string, unknown>)?.reasoning_tokens
    };
  }

  // Gemini format. Antigravity / gemini-cli wrap the payload in { response: {...} }.
  const usageMetadata = (responseBody.usageMetadata || (responseBody.response as Record<string, unknown>)?.usageMetadata) as Record<string, unknown> | undefined;
  if (usageMetadata) {
    return {
      prompt_tokens: usageMetadata.promptTokenCount || 0,
      completion_tokens: usageMetadata.candidatesTokenCount || 0,
      cached_tokens: usageMetadata.cachedContentTokenCount || 0,
      reasoning_tokens: usageMetadata.thoughtsTokenCount || 0
    };
  }

  return null;
}

export function buildRequestDetail(base: RequestDetailBase, overrides: RequestDetailOverrides = {}): Record<string, unknown> {
  return {
    provider: base.provider || "unknown",
    model: base.model || "unknown",
    connectionId: base.connectionId || undefined,
    timestamp: new Date().toISOString(),
    latency: base.latency || { ttft: 0, total: 0 },
    tokens: base.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    request: base.request,
    providerRequest: base.providerRequest || null,
    providerResponse: base.providerResponse || null,
    response: base.response || {},
    pxpipe: base.pxpipe || undefined,
    status: base.status || "success",
    ...overrides
  };
}

// Build the "done" summary: duration, ttft, in/out tokens with cache breakdown
export function formatDoneLine({ usage, latency }: { usage: Record<string, unknown> | null | undefined; latency: Record<string, unknown> | undefined }): string {
  const u = (usage || {}) as Record<string, unknown>;
  const inTok = (u.prompt_tokens ?? u.input_tokens ?? 0) as number;
  const outTok = (u.completion_tokens ?? u.output_tokens ?? 0) as number;
  const cacheRead = (u.cache_read_input_tokens ?? u.cached_tokens ?? (u.prompt_tokens_details as Record<string, unknown>)?.cached_tokens ?? 0) as number;
  const cacheCreate = (u.cache_creation_input_tokens ?? 0) as number;
  let inStr = `IN ${inTok}`;
  if (cacheRead || cacheCreate) {
    const parts: string[] = [];
    if (cacheRead) parts.push(`↻${cacheRead}`);
    if (cacheCreate) parts.push(`+${cacheCreate}`);
    inStr += ` (CACHE ${parts.join(" ")})`;
  }
  const ttftStr = latency?.ttft ? ` · TTFT ${latency.ttft}ms` : "";
  return `DONE ${latency?.total ?? 0}ms${ttftStr} · ${inStr} · OUT ${outTok}`;
}

export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, label = "USAGE", silent = false, meta }: SaveUsageStatsOptions): void {
  if (!tokens || typeof tokens !== "object") return;

  const inTokens = (tokens as Record<string, unknown>).input_tokens ?? (tokens as Record<string, unknown>).prompt_tokens ?? 0;
  const outTokens = (tokens as Record<string, unknown>).output_tokens ?? (tokens as Record<string, unknown>).completion_tokens ?? 0;

  if (inTokens === 0 && outTokens === 0) return;

  if (!silent) {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const accountSuffix = connectionId ? ` | account=${connectionId.slice(0, 8)}...` : "";
    console.log(`${COLORS.green}[${time}] 📊 [${label}] ${provider.toUpperCase()} | in=${inTokens} | out=${outTokens}${accountSuffix}${COLORS.reset}`);
  }

  // Canonicalize to one storage convention (prompt_tokens cache-inclusive) so
  // cached/cache-creation tokens survive to cost calc + stats. See canonicalizeUsage.
  const normalized = canonicalizeUsage(tokens) || {
    prompt_tokens: (tokens as Record<string, unknown>).prompt_tokens ?? (tokens as Record<string, unknown>).input_tokens ?? 0,
    completion_tokens: (tokens as Record<string, unknown>).completion_tokens ?? (tokens as Record<string, unknown>).output_tokens ?? 0
  };

  saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: normalized,
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || undefined,
    meta
  }).catch(() => {});
}
