export interface TokenUsage {
  cached_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  prompt_tokens?: number;
  input_tokens?: number;
  completion_tokens?: number;
}

export interface PxPipeInfo {
  applied?: boolean;
  tokensBeforeEst?: number;
  tokensAfterEst?: number;
  savedPct?: number;
  imageCount?: number;
  durationMs?: number;
  reason?: string;
  detail?: string;
}

export interface RoutingInfo {
  need?: string;
  tier?: string;
  confidence?: number;
  reason?: string;
  candidates?: string[];
  degraded?: boolean;
}

export interface RequestDetail {
  id: string;
  timestamp: string;
  model: string;
  provider: string;
  tokens?: TokenUsage;
  latency?: { ttft?: number; total?: number };
  status?: string;
  pxpipe?: PxPipeInfo;
  request?: { routing?: RoutingInfo; [key: string]: unknown };
  providerRequest?: unknown;
  providerResponse?: string | Record<string, unknown>;
  response?: { thinking?: string; content?: string };
}
