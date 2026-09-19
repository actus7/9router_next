import REGISTRY from "./registry/index";
import type { RegistryEntry } from "./schema";

/**
 * A provider the server cannot call.
 *
 * A registry entry with no `transport` block has no endpoint to reach: it runs
 * entirely in the browser. Puter (MiMo) is the case today — the chat intercepts
 * it client-side through the Puter SDK, and `executors/puter.ts` throws on
 * purpose if a request ever reaches the server.
 */
export function isBrowserOnlyProvider(entry: RegistryEntry | undefined | null): boolean {
  return Boolean(entry) && !(entry as Record<string, unknown>).transport;
}

function entryFor(providerRef: string): RegistryEntry | undefined {
  const needle = providerRef.toLowerCase();
  return (REGISTRY as RegistryEntry[]).find((entry) => {
    const record = entry as Record<string, unknown>;
    return String(record.id ?? "").toLowerCase() === needle
      || String(record.alias ?? "").toLowerCase() === needle;
  });
}

/**
 * The browser-only provider behind `model`, or null when the server can test it.
 *
 * Callers address a model as `<providerAlias>/<modelId>` — that prefix is the
 * connection being tested, and it is what decides the answer. The same model id
 * can belong to two providers with different transports: `xiaomi/mimo-v2.5` is
 * offered by both `puter` (browser-only) and `tokenrouter` (a normal HTTP
 * endpoint), so judging by model id alone would have called it testable and
 * gone right back to the misleading 502.
 *
 * Without a usable prefix the answer is null. Scanning the registry for who
 * declares the model used to cover that case, but providers with a models
 * endpoint no longer ship a catalogue to scan — so the scan would now find only
 * the browser-only half of a shared id and call a testable model untestable.
 */
export function browserOnlyProviderForModel(model: string): string | null {
  if (!model) return null;

  const slash = model.indexOf("/");
  if (slash > 0) {
    const entry = entryFor(model.slice(0, slash));
    if (entry) return isBrowserOnlyProvider(entry) ? String((entry as Record<string, unknown>).id ?? "") : null;
  }

  return null;
}
