import type { ProviderCatalogEntry } from "@/shared/constants/providers";

export interface Connection {
  id: string;
  provider: string;
  authType?: string;
  isActive?: boolean;
  testStatus?: string;
  lastError?: string;
  lastErrorAt?: string;
  lastErrorType?: string;
  errorCode?: string;
  [key: string]: unknown;
}

export interface ProviderNode {
  id: string;
  name?: string;
  type?: string;
  apiType?: string;
}

export type ProviderInfo = ProviderCatalogEntry;

export type AvailabilityFilter = "all" | "free" | "connected";
export type Availability = "free" | "freeTier" | null;

export interface ProviderStats {
  connected: number;
  error: number;
  total: number;
  errorCode: string | null;
  errorTime: string | null;
  allDisabled: boolean;
}

export interface TestResult {
  connectionId?: string;
  connectionName?: string;
  provider?: string;
  valid?: boolean;
  latencyMs?: number;
  diagnosis?: { type?: string };
}

export interface TestResults {
  mode?: string;
  results?: TestResult[];
  summary?: { total: number; passed: number; failed: number };
  error?: string;
}

export interface ProvidersClientProps {
  initialConnections: Connection[];
  initialNodes: ProviderNode[];
}
