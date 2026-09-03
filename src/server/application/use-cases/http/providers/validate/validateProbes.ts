import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getDefaultModel } from "@/server/llm-gateway/catalog";
import { providerValidateFetch } from "./providerValidateFetch";

// Probe a webSearch/webFetch provider using its searchConfig/fetchConfig.
// Returns true if API key is accepted (status !== 401 && !== 403).
export async function probeWebProvider(provider: string, apiKey: string): Promise<boolean | null> {
  const p = AI_PROVIDERS[provider];
  if (!p) return null;
  // Skip if provider has dual-purpose (LLM + search), let LLM validate handle it
  const kinds = p.serviceKinds || ["llm"];
  const isWebOnly = (kinds as string[]).every((k: string) => k === "webSearch" || k === "webFetch");
  if (!isWebOnly) return null;
  const cfg = (p.searchConfig || p.fetchConfig) as Record<string, unknown> | undefined;
  if (!cfg) return null;
  if (cfg.authType === "none") return true; // no-auth (e.g. searxng)

  let url = cfg.baseUrl as string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: string | undefined;

  // Apply auth based on authHeader
  switch (cfg.authHeader as string) {
    case "bearer":              headers["Authorization"] = `Bearer ${apiKey}`; break;
    case "x-api-key":           headers["x-api-key"] = apiKey; break;
    case "x-subscription-token":headers["x-subscription-token"] = apiKey; break;
    case "key":                 url += `?key=${encodeURIComponent(apiKey)}&q=ping&cx=test`; break; // google-pse
    case "api_key":             url += `?api_key=${encodeURIComponent(apiKey)}&q=ping&engine=google`; break; // searchapi
  }

  // Minimal body for POST endpoints; GET sends nothing
  if (cfg.method === "POST") {
    body = JSON.stringify({ query: "ping", q: "ping", url: "https://example.com" });
  }

  const res = await providerValidateFetch(url, { method: cfg.method as string, headers, body, signal: AbortSignal.timeout(8000) }, { providerId: provider });
  return res.status !== 401 && res.status !== 403;
}

// Probe a media provider (tts/embedding/stt/image/video) using *Config.
// Returns true if API key is accepted; null to skip (let default handler decide).
export async function probeMediaProvider(provider: string, apiKey: string): Promise<boolean | null> {
  const p = AI_PROVIDERS[provider];
  if (!p) return null;
  const MEDIA_KINDS = new Set(["tts", "embedding", "stt", "image", "video", "music", "imageToText"]);
  const kinds = p.serviceKinds || ["llm"];
  const isMediaOnly = (kinds as string[]).every((k: string) => MEDIA_KINDS.has(k));
  if (!isMediaOnly) return null;
  const cfg = (p.ttsConfig || p.sttConfig || p.embeddingConfig || p.imageConfig || p.videoConfig || p.musicConfig) as Record<string, unknown> | undefined;
  // No probe config → best-effort accept (validate at usage time)
  if (!cfg) return true;
  if (p.noAuth || cfg.authType === "none") return true;
  // Skip auth schemes that need provider-specific data
  if (cfg.authHeader === "playht" || cfg.authHeader === "aws-sigv4") return true;

  const headers: Record<string, string> = { "Content-Type": "application/json", ...((cfg.extraHeaders as Record<string, string>) || {}) };

  switch (cfg.authHeader as string) {
    case "bearer":     headers["Authorization"] = `Bearer ${apiKey}`; break;
    case "key":        headers["Authorization"] = `Key ${apiKey}`; break;
    case "x-api-key":  headers["x-api-key"] = apiKey; break;
    case "x-key":      headers["x-key"] = apiKey; break;
    case "xi-api-key": headers["xi-api-key"] = apiKey; break;
    case "token":      headers["Authorization"] = `Token ${apiKey}`; break;
    case "basic":      headers["Authorization"] = `Basic ${apiKey}`; break;
    default: return null;
  }

  const method = (cfg.method as string) || "POST";
  const res = await providerValidateFetch(cfg.baseUrl as string, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify({ input: "ping", text: "ping", prompt: "ping", model: getDefaultModel(provider) || "test" }),
    signal: AbortSignal.timeout(8000),
  }, { providerId: provider });
  return res.status !== 401 && res.status !== 403;
}
