// Provider definitions
import { REGISTRY } from "@/shared/llm-catalog";
import { RISK_NOTICE } from "@/shared/constants/providersDisplay";

const MEDIA_ENTRY_KEYS = [
  "serviceKinds", "ttsConfig", "sttConfig", "embeddingConfig",
  "imageConfig", "imageToTextConfig", "videoConfig", "musicConfig",
  "searchViaChat", "searchConfig", "fetchConfig",
  "modelsFetcher", "mediaPriority", "hiddenKinds",
] as const;

export const PROVIDER_CATEGORIES = ["free", "freeTier", "oauth", "apikey", "webCookie"] as const;
export type ProviderCategory = typeof PROVIDER_CATEGORIES[number];
export type ProviderAuthMode = "oauth" | "apikey" | "api_key" | "cookie" | "none";
export type ProviderAvailability = "free" | "freeTier" | "paid";

export interface ProviderCatalogEntry extends Record<string, unknown> {
  id: string;
  alias: string;
  category: ProviderCategory;
  name: string;
  color?: string;
  textIcon?: string;
  icon?: string;
  priority?: number;
  apiType?: string;
  authModes?: ProviderAuthMode[];
  noAuth?: boolean;
  hasFree?: boolean;
  hidden?: boolean;
  serviceKinds?: string[];
}

type RegistryEntry = Record<string, unknown>;

function isProviderCategory(value: unknown): value is ProviderCategory {
  return typeof value === "string" && (PROVIDER_CATEGORIES as readonly string[]).includes(value);
}

// Build provider UI object from registry entry
function buildProviderEntry(r: RegistryEntry): ProviderCatalogEntry {
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
    category: isProviderCategory(r.category) ? r.category : "apikey",
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
  } as ProviderCatalogEntry;
}

const byCategory = (cat: ProviderCategory): Record<string, ProviderCatalogEntry> => Object.fromEntries(
  REGISTRY.filter((r: RegistryEntry) => r.category === cat).map((r: RegistryEntry) => [r.id, buildProviderEntry(r)])
);

export const FREE_PROVIDERS = byCategory("free");
export const FREE_TIER_PROVIDERS = byCategory("freeTier");

// Thinking config definitions
// options: list of selectable modes ("auto" = no override from server)
// defaultMode: fallback when user hasn't configured
// extended: claude-style thinking (thinking.type + budget_tokens) — used by most providers
// effort: openai-style reasoning_effort — only openai + codex
void ({
  extended: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
    defaultBudgetTokens: 10000
  },
  effort: {
    options: ["auto", "none", "low", "medium", "high"],
    defaultMode: "auto"
  }
} as const);


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
export const AI_PROVIDERS: Record<string, ProviderCatalogEntry> = { ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...OAUTH_PROVIDERS, ...APIKEY_PROVIDERS, ...WEB_COOKIE_PROVIDERS };

/** Single source of truth for dashboard grouping and connection matching. */
export function getProviderConnectionAuthTypes(provider: ProviderCatalogEntry): ProviderAuthMode[] {
  const configured = Array.isArray(provider.authModes)
    ? provider.authModes.filter((mode): mode is ProviderAuthMode => ["oauth", "apikey", "api_key", "cookie", "none"].includes(mode))
    : [];
  if (configured.length > 0) return configured.flatMap((mode) => mode === "apikey" ? ["apikey", "api_key"] : [mode]);
  if (provider.noAuth) return ["none"];
  if (provider.category === "webCookie") return ["cookie"];
  if (provider.category === "oauth") return ["oauth"];
  if (provider.category === "free" || provider.category === "freeTier") return ["oauth", "apikey", "api_key"];
  return ["apikey", "api_key"];
}

export function getProviderAvailability(provider: ProviderCatalogEntry): ProviderAvailability {
  if (provider.noAuth) return "free";
  if (provider.hasFree || provider.category === "free" || provider.category === "freeTier") return "freeTier";
  return "paid";
}

export function validateProviderCatalog(entries: readonly RegistryEntry[] = REGISTRY as RegistryEntry[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const aliases = new Set<string>();
  for (const entry of entries) {
    const id = typeof entry.id === "string" ? entry.id : "";
    const alias = typeof (entry.uiAlias || entry.alias) === "string" ? String(entry.uiAlias || entry.alias) : "";
    if (!id) errors.push("Provider registry entry has no id");
    else if (ids.has(id)) errors.push(`Duplicate provider id: ${id}`);
    else ids.add(id);
    if (!alias) errors.push(`Provider ${id || "<unknown>"} has no alias`);
    else if (aliases.has(alias)) errors.push(`Duplicate provider alias: ${alias}`);
    else aliases.add(alias);
    if (!isProviderCategory(entry.category)) errors.push(`Provider ${id || alias} has invalid category`);
    if (Array.isArray(entry.authModes) && entry.authModes.some((mode) => !["oauth", "apikey", "api_key", "cookie", "none"].includes(String(mode)))) errors.push(`Provider ${id || alias} has invalid auth mode`);
    if (entry.noAuth === true && Array.isArray(entry.authModes) && entry.authModes.some((mode) => mode !== "none")) errors.push(`Provider ${id || alias} mixes noAuth with credential auth`);
  }
  return errors;
}

// Auth methods
void ({
  oauth: { id: "oauth" },
  apikey: { id: "apikey" },
  cookie: { id: "cookie" },
} as const);


// Helper: Get provider by alias
export function getProviderByAlias(alias: string): ProviderCatalogEntry | null {
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
void (Object.values(AI_PROVIDERS).reduce((acc: Record<string, string>, p) => {
  acc[p.id as string] = p.alias as string;
  return acc;
}, {}));

// Helper: Get providers by service kind (e.g. "tts", "embedding", "image")
// Providers without serviceKinds default to ["llm"]
export function getProvidersByKind(kind: string): ProviderCatalogEntry[] {
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
