// Barrel: PROVIDERS now built from providers/registry (transport co-located with models)
import { PROVIDERS } from "../providers/index";
export { PROVIDERS, PROVIDER_OAUTH } from "../providers/index";

export const OLLAMA_LOCAL_DEFAULT_HOST = "http://localhost:11434";

export function resolveOllamaLocalHost(credentials: Record<string, unknown> | undefined) {
  const psd = credentials?.providerSpecificData as Record<string, unknown> | undefined;
  const raw = (psd?.baseUrl as string | undefined)?.trim();
  return (raw || OLLAMA_LOCAL_DEFAULT_HOST).replace(/\/$/, "");
}

// Region URLs single-source from registry xiaomi-tokenplan.transport
export const XIAOMI_TOKENPLAN_REGIONS: Record<string, string> = (PROVIDERS["xiaomi-tokenplan"]?.regions as Record<string, string>) || {};
export const XIAOMI_TOKENPLAN_DEFAULT_REGION = PROVIDERS["xiaomi-tokenplan"]?.defaultRegion as string | undefined;

export function resolveXiaomiTokenplanBaseUrl(credentials: Record<string, unknown> | undefined) {
  const psd = credentials?.providerSpecificData as Record<string, unknown> | undefined;
  const region = psd?.region as string | undefined;
  return XIAOMI_TOKENPLAN_REGIONS[region as string] || XIAOMI_TOKENPLAN_REGIONS[XIAOMI_TOKENPLAN_DEFAULT_REGION as string];
}
