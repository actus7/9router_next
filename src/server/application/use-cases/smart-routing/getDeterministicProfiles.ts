import "server-only";

import {
  refreshDeterministicSmartProfiles,
  type SmartModelProfile,
} from "@/server/llm-gateway/smart-routing";

/** Load deterministic smart-routing profiles for dashboard/server consumers. */
export async function getDeterministicSmartProfiles(): Promise<SmartModelProfile[]> {
  return refreshDeterministicSmartProfiles();
}
