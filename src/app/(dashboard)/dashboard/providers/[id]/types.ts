// Shared types for the providers/[id] detail page — used by ProviderDetailClient
// and the hooks/sections it composes.

export interface Connection {
  id: string;
  name?: string;
  email?: string;
  displayName?: string;
  authType?: string;
  testStatus?: string;
  isActive?: boolean;
  lastError?: string;
  priority?: number;
  globalPriority?: number;
  provider?: string;
  providerSpecificData?: {
    proxyPoolId?: string;
    connectionProxyEnabled?: boolean;
    connectionProxyUrl?: string;
    connectionNoProxy?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ProxyPool {
  id: string;
  name: string;
  proxyUrl?: string;
  noProxy?: string;
  isActive?: boolean;
}

export interface ProviderNode {
  id: string;
  name?: string;
  prefix?: string;
  apiType?: string;
  baseUrl?: string;
  type?: string;
  [key: string]: unknown;
}

export interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}

export interface OneByOneResult {
  state: string;
  error?: string | null;
}

export interface OneByOneSummary {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  stopped: boolean;
}

export interface AutoPingConfig {
  enabled: boolean;
  connections: Record<string, boolean>;
}

export interface SuggestedModel {
  id: string;
  name: string;
  contextLength?: number;
}

export interface CustomModelEntry {
  id: string;
  providerAlias?: string;
  kind?: string;
  type?: string;
  source?: "manual" | "discovered";
  [key: string]: unknown;
}

export interface ProviderInfo {
  id: string;
  name: string;
  color?: string;
  textIcon?: string;
  apiType?: string;
  baseUrl?: string;
  type?: string;
  notice?: { apiKeyUrl?: string; signupUrl?: string; text?: string };
  deprecated?: boolean;
  deprecationNotice?: string;
  website?: string;
  authType?: string;
  authHint?: string;
  authModes?: string[];
  [key: string]: unknown;
}

// One entry in the "Test All Models" diagnostics run.
export interface ModelDiagnostic {
  modelId: string;
  ok: boolean;
  state?: "queued" | "testing" | "retrying" | "passed" | "failed" | "cancelled";
  error?: string;
  attempts: number;
  latencyMs?: number;
  status?: number;
}

export interface LiveModel {
  id: string;
  name?: string;
  isFree?: boolean;
  [key: string]: unknown;
}
