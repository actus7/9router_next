import {
  buildHarnessCatalog,
  HARNESS_PLUGINS,
  type HarnessCatalog,
  type HarnessPluginDefinition,
} from "@/shared/harness/agentPlugins";
import type { BundleRow, ResolvedRow } from "./composition";
import { HARNESS_CAPABILITY, PROVIDER_EXECUTOR } from "./factories";

// The rows this repository ships. The stored patch layer is applied on top of
// them, so an empty table reproduces exactly what the bundle declares here.

const capabilityRows: BundleRow[] = HARNESS_PLUGINS.map((plugin) => ({
  id: plugin.id,
  plugin: HARNESS_CAPABILITY,
  config: plugin as unknown as Record<string, unknown>,
}));

const executorRows: BundleRow[] = [
  { id: "executor-opencode", plugin: PROVIDER_EXECUTOR, config: { provider: "opencode" } },
];

export const BUNDLE_ROWS: readonly BundleRow[] = [...capabilityRows, ...executorRows];

/**
 * Projects the capability rows of a composed tree into the catalogue the chat
 * resolves against. Executor rows are mounted separately and contribute nothing
 * to the agent's capabilities.
 */
export function catalogFromRows(rows: readonly ResolvedRow[]): HarnessCatalog {
  const plugins = rows
    .filter((row) => row.plugin === HARNESS_CAPABILITY)
    .map((row) => row.config as unknown as HarnessPluginDefinition);
  return buildHarnessCatalog(plugins);
}
