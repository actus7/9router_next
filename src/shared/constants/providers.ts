// Provider definitions
import { REGISTRY } from "@/shared/llm-catalog";
import { RISK_NOTICE } from "@/shared/constants/providersDisplay";

const MEDIA_ENTRY_KEYS = [
  "serviceKinds", "ttsConfig", "sttConfig", "embeddingConfig",
  "imageConfig", "imageToTextConfig", "videoConfig", "musicConfig",
  "searchViaChat", "searchConfig", "fetchConfig",
  "modelsFetcher", "mediaPriority", "hiddenKinds",
] as const;

// Build provider UI object from registry entry
function buildProviderEntry(r: Record<string, unknown>): Record<string, unknown> {
  const mediaFields: Record<string, unknown> = {};
  if (r.media) Object.assign(mediaFields, r.media as Record<string, unknown>);
  for (const k of MEDIA_ENTRY_KEYS) {
    if (r[k] !== undefined) mediaFields[k] = r[k];
  }
  const display: Record<string, unknown> = { ...((r.display || {}) as Record<string, unknown>) };
  if (display.deprecationNotice === "RISK_NOTICE") display.deprecationNotice = RISK_NOTICE;
  return {
    ...display,
    id: r.id,
    alias: r.uiAlias || r.alias,
    ...(r.hidden ? { hidden: true } : {}),
    ...mediaFields,
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
    ...(r.hasFree ? { hasFree: true } : {}),
    ...(r.thinkingConfig ? { thinkingConfig: r.thinkingConfig } : {}),
    ...(r.regions ? { regions: r.regions, defaultRegion: r.defaultRegion } : {}),
    ...(r.hasProviderSpecificData ? { hasProviderSpecificData: true } : {}),
    ...(r.noAuth ? { noAuth: true } : {}),
    ...(r.passthroughModels ? { passthroughModels: true } : {}),
    ...(r.noModelDiscovery ? { noModelDiscovery: true } : {}),
    ...(r.hasOAuth ? { hasOAuth: true } : {}),
    ...(r.authModes ? { authModes: r.authModes } : {}),
    ...(r.authType ? { authType: r.authType } : {}),
    ...(r.authHint ? { authHint: r.authHint } : {}),
  };
}

const byCategory = (cat: string): Record<string, Record<string, unknown>> => Object.fromEntries(
  REGISTRY.filter((r: Record<string, unknown>) => r.category === cat).map((r: Record<string, unknown>) => [r.id, buildProviderEntry(r)])
);

export const FREE_PROVIDERS = byCategory("free");
export const FREE_TIER_PROVIDERS = byCategory("freeTier");

// Thinking config definitions
// options: list of selectable modes ("auto" = no override from server)
// defaultMode: fallback when user hasn't configured
// extended: claude-style thinking (thinking.type + budget_tokens) — used by most providers
// effort: openai-style reasoning_effort — only openai + codex
const THINKING_CONFIG = {
  extended: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
    defaultBudgetTokens: 10000
  },
  effort: {
    options: ["auto", "none", "low", "medium", "high"],
    defaultMode: "auto"
  }
} as const;

type ThinkingConfig = typeof THINKING_CONFIG;

export const OAUTH_PROVIDERS = byCategory("oauth");
export const APIKEY_PROVIDERS = byCategory("apikey");

// Web Cookie Providers (use browser session cookie instead of API key)
export const WEB_COOKIE_PROVIDERS = byCategory("webCookie");

interface MediaProviderKind {
  id: string;
  label: string;
  icon: string;
  endpoint: { method: "POST"; path: string };
}

// Media provider kinds — each kind maps to a route and endpoint config
export const MEDIA_PROVIDER_KINDS: readonly MediaProviderKind[] = [
  { id: "embedding",   label: "Embedding",      icon: "data_array",        endpoint: { method: "POST", path: "/v1/embeddings" } },
  { id: "image",       label: "Text to Image",  icon: "brush",             endpoint: { method: "POST", path: "/v1/images/generations" } },
  { id: "imageToText", label: "Image to Text",  icon: "image_search",      endpoint: { method: "POST", path: "/v1/images/understanding" } },
  { id: "tts",         label: "Text To Speech", icon: "record_voice_over", endpoint: { method: "POST", path: "/v1/audio/speech" } },
  { id: "stt",         label: "Speech To Text", icon: "mic",               endpoint: { method: "POST", path: "/v1/audio/transcriptions" } },
  { id: "webSearch",   label: "Web Search",     icon: "travel_explore",    endpoint: { method: "POST", path: "/v1/search" } },
  { id: "webFetch",    label: "Web Fetch",      icon: "language",          endpoint: { method: "POST", path: "/v1/web/fetch" } },
  { id: "video",       label: "Video",          icon: "movie",             endpoint: { method: "POST", path: "/v1/videos/generations" } },
  { id: "music",       label: "Music",          icon: "music_note",        endpoint: { method: "POST", path: "/v1/audio/music" } },
] as const;

type MediaProviderKindId = (typeof MEDIA_PROVIDER_KINDS)[number]["id"];

export const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-" as const;
export const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-" as const;
export const CUSTOM_EMBEDDING_PREFIX = "custom-embedding-" as const;

export function isOpenAICompatibleProvider(providerId: string): boolean {
  return typeof providerId === "string" && providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

export function isAnthropicCompatibleProvider(providerId: string): boolean {
  return typeof providerId === "string" && providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

export function isCustomEmbeddingProvider(providerId: string): boolean {
  return typeof providerId === "string" && providerId.startsWith(CUSTOM_EMBEDDING_PREFIX);
}

// All providers (combined)
export const AI_PROVIDERS: Record<string, Record<string, unknown>> = { ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...OAUTH_PROVIDERS, ...APIKEY_PROVIDERS, ...WEB_COOKIE_PROVIDERS };

// Auth methods
const AUTH_METHODS = {
  oauth: { id: "oauth" },
  apikey: { id: "apikey" },
  cookie: { id: "cookie" },
} as const;

type AuthMethodKey = keyof typeof AUTH_METHODS;

// Helper: Get provider by alias
export function getProviderByAlias(alias: string): Record<string, unknown> | null {
  const needle = typeof alias === "string" ? alias.toLowerCase() : alias;
  for (const provider of Object.values(AI_PROVIDERS)) {
    const legacyAliases = Array.isArray(provider.aliases)
      ? provider.aliases.filter((value): value is string => typeof value === "string")
      : [];
    if (
      (typeof provider.alias === "string" && provider.alias.toLowerCase() === needle) ||
      legacyAliases.some((value) => value.toLowerCase() === needle) ||
      (typeof provider.id === "string" && provider.id.toLowerCase() === needle)
    ) {
      return provider;
    }
  }
  return null;
}

// Helper: Get provider ID from alias
export function resolveProviderId(aliasOrId: string): string {
  const provider = getProviderByAlias(aliasOrId);
  return (provider?.id as string) || aliasOrId;
}

// Helper: Get alias from provider ID
export function getProviderAlias(providerId: string): string {
  const provider = AI_PROVIDERS[providerId];
  return (provider?.alias as string) || providerId;
}

// Alias to ID mapping (for quick lookup)
export const ALIAS_TO_ID: Record<string, string> = Object.values(AI_PROVIDERS).reduce((acc: Record<string, string>, p) => {
  acc[p.alias as string] = p.id as string;
  return acc;
}, {});

// ID to Alias mapping
const ID_TO_ALIAS: Record<string, string> = Object.values(AI_PROVIDERS).reduce((acc: Record<string, string>, p) => {
  acc[p.id as string] = p.alias as string;
  return acc;
}, {});

// Helper: Get providers by service kind (e.g. "tts", "embedding", "image")
// Providers without serviceKinds default to ["llm"]
export function getProvidersByKind(kind: string): Record<string, unknown>[] {
  return Object.values(AI_PROVIDERS)
    .filter((p) => {
      const kinds = (p.serviceKinds as string[] | undefined) ?? ["llm"];
      if (!kinds.includes(kind)) return false;
      if (p.hidden) return false;
      if ((p.hiddenKinds as string[] | undefined)?.includes(kind)) return false;
      return true;
    })
    .sort((a, b) => ((a.priority as number) ?? (a.mediaPriority as number) ?? 999) - ((b.priority as number) ?? (b.mediaPriority as number) ?? 999));
}

// Derive từ registry features flags
export const USAGE_SUPPORTED_PROVIDERS: string[] = REGISTRY
  .filter((r: Record<string, unknown>) => (r.features as Record<string, unknown>)?.usage)
  .map((r: Record<string, unknown>) => r.id as string);

export const USAGE_APIKEY_PROVIDERS: string[] = REGISTRY
  .filter((r: Record<string, unknown>) => (r.features as Record<string, unknown>)?.usageApikey)
  .map((r: Record<string, unknown>) => r.id as string);
