import type { CloudProvider, CloudProviderDriver } from "./driver";
import { renderDriver } from "./render";
import { railwayDriver } from "./railway";

export const CLOUD_PROVIDERS: Record<CloudProvider, CloudProviderDriver> = {
  render: renderDriver,
  railway: railwayDriver,
};

export function getCloudProviderDriver(provider: string): CloudProviderDriver | null {
  if (provider === "render" || provider === "railway") return CLOUD_PROVIDERS[provider];
  return null;
}
