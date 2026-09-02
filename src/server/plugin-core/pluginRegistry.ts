// Plain, synchronous overlay consulted by the existing (non-Cordis) executor
// lookup in `engine/executors/index.ts`. Plugins write here through
// `ExecutorsService`/`ProvidersService`; the hot-path lookup functions read
// from here directly, so no request handler needs to await the Cordis
// context — the state is just in-memory and boot-time populated.
import type { ProviderConfig } from "./services/providers-service";

const pluginExecutors = new Map<string, unknown>();
const pluginProviders = new Map<string, ProviderConfig>();

export function registerExecutor(provider: string, executor: unknown): void {
  pluginExecutors.set(provider, executor);
}

export function getPluginExecutor(provider: string): unknown {
  return pluginExecutors.get(provider);
}

export function hasPluginExecutor(provider: string): boolean {
  return pluginExecutors.has(provider);
}

export function registerProvider(config: ProviderConfig): void {
  pluginProviders.set(config.id, config);
}

export function listPluginProviders(): ProviderConfig[] {
  return [...pluginProviders.values()];
}

/** Test-only: clear both overlays. Production code never calls this — the overlay is meant to persist for the process lifetime. */
export function resetPluginRegistry(): void {
  pluginExecutors.clear();
  pluginProviders.clear();
}
