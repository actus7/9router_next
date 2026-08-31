// Barrel: PROVIDERS now built from providers/registry (transport co-located with models)
import { PROVIDERS } from "../providers/index";
export { PROVIDERS, PROVIDER_OAUTH } from "../providers/index";

// Region URLs single-source from registry xiaomi-tokenplan.transport
const XIAOMI_TOKENPLAN_REGIONS: Record<string, string> = (PROVIDERS["xiaomi-tokenplan"]?.regions as Record<string, string>) || {};
const XIAOMI_TOKENPLAN_DEFAULT_REGION = PROVIDERS["xiaomi-tokenplan"]?.defaultRegion as string | undefined;

export function resolveXiaomiTokenplanBaseUrl(credentials: Record<string, unknown> | undefined) {
  const psd = credentials?.providerSpecificData as Record<string, unknown> | undefined;
  const region = psd?.region as string | undefined;
  return XIAOMI_TOKENPLAN_REGIONS[region as string] || XIAOMI_TOKENPLAN_REGIONS[XIAOMI_TOKENPLAN_DEFAULT_REGION as string];
}
