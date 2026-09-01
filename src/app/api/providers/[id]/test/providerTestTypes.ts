export interface TestResult {
  valid: boolean;
  error: string | null;
  refreshed?: boolean;
  newTokens?: Record<string, unknown> | null;
  warning?: string | null;
}

export interface ConnectionProxyConfig {
  connectionProxyEnabled?: boolean;
  connectionProxyUrl?: string;
  connectionNoProxy?: string;
  vercelRelayUrl?: string;
  strictProxy?: boolean;
}

