// Provider transport schema: shared defaults + endpoint defaults + resolver (skeleton, not wired)
import { DEFAULT_RETRY_CONFIG, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig";
import { MEDIA_ENTRY_KEYS } from "./mediaKeys";

/**
 * Registry entry contract for registry/{id}.ts. The top level is the
 * `RegistryEntry` interface below; see REGISTRY_TEMPLATE.ts for a worked
 * example. Only `id` and `category` are required. The nested blocks stay
 * untyped because their shape varies by transport format, so they are
 * documented here instead.
 *
 * TransportConfig: { baseUrl, format, headers, auth, forceStream, urlSuffix, quirks, retry, timeoutMs,
 *   executor, clientId, clientSecret, tokenUrl, refreshUrl, usage, cliVersion, apiClient, regions,
 *   defaultRegion, modelsFetcher, validateUrl, responsesUrl } — clientId/clientSecret/tokenUrl are
 *   injected from `oauth` automatically (single source); declare them in `oauth`, not here.
 *
 * OAuthConfig: { clientId, authorizeUrl, tokenUrl, deviceCodeUrl, refreshUrl, scope|scopes, redirectUri,
 *   callbackPath, fixedPort, codeChallengeMethod, extraParams, refresh:{encoding,scope}, refreshLeadMs,
 *   userInfoUrl }.
 *
 * Media fields sit at the entry root, not in a nested block: serviceKinds,
 *   ttsConfig, sttConfig, embeddingConfig, imageConfig, searchViaChat:
 *   {defaultModel,pricingUrl}, hiddenKinds — see MEDIA_ENTRY_KEYS for the full
 *   list. Each *Config: {baseUrl,authType,authHeader,format,defaultModel,
 *   models:[{id,name,dimensions?}]}.
 */

/**
 * The contract above, as a type the compiler can hold you to. Nested blocks stay
 * loose on purpose: their shape varies per provider and per transport format.
 * `REGISTRY_TOP_LEVEL_KEYS` below is the same list at runtime, so a mistyped
 * field name is caught by tests/unit/providerCatalog.test.ts rather than by
 * silently having no effect.
 */
export interface RegistryEntry extends Record<string, unknown> {
  // Identity
  id: string;
  category: string;
  alias?: string;
  aliases?: string[];
  uiAlias?: string;
  priority?: number;
  // Auth
  authType?: string;
  authHint?: string;
  authModes?: string[];
  hasOAuth?: boolean;
  hasFree?: boolean;
  noAuth?: boolean;
  hasProviderSpecificData?: boolean;
  oauth?: Record<string, unknown>;
  // Presentation
  display?: Record<string, unknown>;
  notice?: unknown;
  hidden?: boolean;
  // Transport
  transport?: Record<string, unknown>;
  transports?: unknown;
  regions?: unknown;
  defaultRegion?: string;
  passthroughModels?: boolean;
  // Models
  models?: unknown[];
  modelsFetcher?: unknown;
  noModelDiscovery?: boolean;
  features?: Record<string, unknown>;
  thinkingConfig?: Record<string, unknown>;
  // Media and search surface (see MEDIA_ENTRY_KEYS — these sit at the entry
  // root, not under a nested block)
  serviceKinds?: string[];
  ttsConfig?: Record<string, unknown>;
  sttConfig?: Record<string, unknown>;
  embeddingConfig?: Record<string, unknown>;
  imageConfig?: Record<string, unknown>;
  imageToTextConfig?: Record<string, unknown>;
  videoConfig?: Record<string, unknown>;
  musicConfig?: Record<string, unknown>;
  searchViaChat?: Record<string, unknown>;
  searchConfig?: Record<string, unknown>;
  fetchConfig?: Record<string, unknown>;
  mediaPriority?: unknown;
  hiddenKinds?: string[];
}

/** Runtime mirror of RegistryEntry's keys, for the unknown-field guard. */
export const REGISTRY_TOP_LEVEL_KEYS: readonly string[] = [
  "id", "category", "alias", "aliases", "uiAlias", "priority",
  "authType", "authHint", "authModes", "hasOAuth", "hasFree", "noAuth",
  "hasProviderSpecificData", "oauth",
  "display", "notice", "hidden",
  "transport", "transports", "regions", "defaultRegion", "passthroughModels",
  "models", "noModelDiscovery", "features", "thinkingConfig",
  ...MEDIA_ENTRY_KEYS,
];

// Shared transport defaults — provider only overrides fields that differ.
// NOTE: runtime (index.js buildTransport) only re-applies `format`; the rest documents the contract
// and feeds the (currently unwired) resolveProvider(). Adding keys here does NOT change PROVIDERS.
export const PROVIDER_DEFAULTS = {
  baseUrl: "",
  format: "openai",
  headers: {},
  auth: { header: "Authorization", scheme: "bearer", source: ["accessToken", "apiKey"] },
  forceStream: false,
  urlSuffix: "",
  quirks: {},
  passthroughModels: false,
  retry: DEFAULT_RETRY_CONFIG,
  timeoutMs: FETCH_CONNECT_TIMEOUT_MS,
  executor: "default"
};

// Default endpoints per format (provider only overrides what differs)

// Deep-merge a provider entry over PROVIDER_DEFAULTS (defensive for missing transport)
