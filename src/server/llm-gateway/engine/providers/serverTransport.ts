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

function declaresModel(entry: RegistryEntry, modelId: string): boolean {
  const models = (entry as Record<string, unknown>).models as Array<{ id?: string }> | undefined;
  return Array.isArray(models) && models.some((m) => m?.id === modelId);
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
 * Falls back to the model id when there is no usable prefix, and only reports
 * browser-only if *every* provider offering it is.
 */
export function browserOnlyProviderForModel(model: string): string | null {
  if (!model) return null;

  const slash = model.indexOf("/");
  if (slash > 0) {
    const entry = entryFor(model.slice(0, slash));
    if (entry) return isBrowserOnlyProvider(entry) ? String((entry as Record<string, unknown>).id ?? "") : null;
  }

  const owners = (REGISTRY as RegistryEntry[]).filter((entry) => declaresModel(entry, model));
  if (owners.length === 0) return null;
  if (!owners.every(isBrowserOnlyProvider)) return null;
  return String((owners[0] as Record<string, unknown>).id ?? "");
}
