// The probe answer shape is shared with the validate family. This file keeps
// only the transport config specific to testing a saved connection.
export type { ProbeResult as TestResult } from "@/server/llm-gateway/probe/types";

export interface ConnectionProxyConfig {
  connectionProxyEnabled?: boolean;
  connectionProxyUrl?: string;
  connectionNoProxy?: string;
  vercelRelayUrl?: string;
  strictProxy?: boolean;
}

