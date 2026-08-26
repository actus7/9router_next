/**
 * Shared type definitions for open-sse services.
 * Zero runtime footprint — interfaces/types only.
 */

// ── Logger ───────────────────────────────────────────────────────────────────
export interface Logger {
  debug?(tag: string, message: string, meta?: unknown): void;
  info?(tag: string, message: string, meta?: unknown): void;
  warn?(tag: string, message: string, meta?: unknown): void;
  error?(tag: string, message: string, meta?: unknown): void;
}

// ── Provider-specific data (connection.providerSpecificData) ─────────────────
export interface ProviderSpecificData {
  [key: string]: unknown;
  apiType?: string;
  copilotToken?: string;
  copilotTokenExpiresAt?: string;
  machineId?: string;
  profileArn?: string;
  authMethod?: string;
  clientId?: string;
  clientSecret?: string;
  region?: string;
  deviceId?: string;
  userId?: string;
  username?: string;
  lastRefreshAt?: string;
  email?: string;
  principalId?: string;
  ghostMode?: boolean;
  kimchiEndpoint?: string;
  apiKey?: string;
}

// ── Credentials (connection record / credential object) ──────────────────────
export interface Credentials {
  [key: string]: unknown;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  expiresAt?: string;
  tokenExpiresAt?: string;
  lastRefreshAt?: string;
  lastRefresh?: string;
  idToken?: string;
  projectId?: string;
  token?: string;
  copilotToken?: string;
  copilotTokenExpiresAt?: string;
  providerSpecificData?: ProviderSpecificData;
  connectionId?: string;
  id?: string;
  email?: string;
  name?: string;
  displayName?: string;
}

// ── Refresh result (returned by all provider refresh functions) ──────────────
export interface RefreshResult {
  [key: string]: unknown;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  idToken?: string;
  token?: string;
  expiresAt?: string;
  error?: string;
  code?: string;
  projectId?: string;
  providerSpecificData?: ProviderSpecificData;
  copilotToken?: string;
  copilotTokenExpiresAt?: string;
  lastRefreshAt?: string;
  apiKey?: string;
}

// ── Vertex service account JSON ──────────────────────────────────────────────
export interface VertexServiceAccount {
  type: string;
  client_email: string;
  private_key: string;
  project_id: string;
  [key: string]: unknown;
}

// ── Account / connection for fallback logic ──────────────────────────────────
export interface Account {
  [key: string]: unknown;
  id?: string;
  rateLimitedUntil?: string;
  backoffLevel?: number;
  lastError?: { status: number; message: string; timestamp: string } | null;
  status?: string;
  isActive?: boolean;
  provider?: string;
  refreshToken?: string;
}

// ── User info (for getAllAccessTokens) ───────────────────────────────────────
export interface UserInfo {
  connections?: Account[];
  [key: string]: unknown;
}

// ── Error rule (from errorConfig) ────────────────────────────────────────────
export interface ErrorRule {
  text?: string;
  status?: number;
  cooldownMs: number;
  backoff?: boolean;
}

// ── Refresh handler signature ────────────────────────────────────────────────
export type RefreshHandler = (c: Credentials, log?: Logger) => Promise<RefreshResult | null> | null;

// ── Combo types ──────────────────────────────────────────────────────────────
export interface ComboEntry {
  name: string;
  models: string[];
  [key: string]: unknown;
}

export interface CombosData {
  combos?: ComboEntry[];
  [key: string]: unknown;
}

// ── Capacity adapter settings ────────────────────────────────────────────────
export interface CapacityAdapterEntry {
  enabled?: boolean;
  roundRobin?: boolean;
  models?: string[];
}

export interface CapacityAdapterLegacyEntry {
  model?: string;
  enabled?: boolean;
}

export interface Settings {
  capacityAdapter?: Record<string, CapacityAdapterEntry | CapacityAdapterLegacyEntry[]>;
  [key: string]: unknown;
}

// ── Registry entry (from providers/registry) ────────────────────────────────
export interface RegistryEntry {
  id: string;
  alias?: string;
  aliases?: string[];
  [key: string]: unknown;
}

// ── Model aliases map ────────────────────────────────────────────────────────
export interface ModelAliases {
  [alias: string]: string | { provider: string; model: string };
}

// ── Request body (chat/completion request) ───────────────────────────────────
export interface RequestBody {
  [key: string]: unknown;
  input?: unknown;
  messages?: Record<string, unknown>[];
  contents?: Record<string, unknown>[];
  request?: { contents?: Record<string, unknown>[] };
  system?: unknown;
  anthropic_version?: string;
  model?: string;
  userAgent?: string;
  stream_options?: unknown;
  response_format?: unknown;
  logprobs?: unknown;
  top_logprobs?: unknown;
  n?: unknown;
  presence_penalty?: unknown;
  frequency_penalty?: unknown;
  logit_bias?: unknown;
  user?: unknown;
  reasoning_effort?: unknown;
  thinking?: { type?: string };
  tools?: unknown[];
  tool_choice?: unknown;
  stream?: boolean;
}

// ── Refresh profile (per-provider refresh config) ────────────────────────────
export interface RefreshProfile {
  bodyFormat?: string;
  includeClientSecret?: boolean | ((cfg: Record<string, unknown>) => boolean);
  url?: () => string;
  dedupKey?: string;
  extraHeaders?: (creds: Credentials, cfg: Record<string, unknown>) => Record<string, string>;
  parse?: (tokens: Record<string, unknown>) => Record<string, unknown> | null;
}

// ── Provider config (from PROVIDERS[id]) ─────────────────────────────────────
export interface ProviderConfig {
  [key: string]: unknown;
  clientId?: string;
  clientSecret?: string;
  refreshUrl?: string;
  tokenUrl?: string;
  format?: string;
  copilot?: Record<string, unknown>;
}

// ── OAuth provider config (from PROVIDER_OAUTH[id]) ──────────────────────────
export interface OAuthProviderConfig {
  [key: string]: unknown;
  tokenUrl?: string;
  refreshUrl?: string;
  clientId?: string;
  clientSecret?: string;
  maxRefreshAgeMs?: number;
  trackRefreshAt?: boolean;
  copilotTokenUrl?: string;
  exchangeTokenUrl?: string;
  userAgent?: string;
  agentEndpoint?: string;
  modelsEndpoint?: string;
}
