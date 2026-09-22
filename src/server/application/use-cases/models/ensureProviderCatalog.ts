import { makeKv } from "@/lib/db/helpers/kvStore";
import { currentTenantId } from "@/lib/db/tenant";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { syncDiscoveredCustomModels, pickDiscoveredMetadata, discoveredModelKind } from "@/models";
import { PROVIDER_ID_TO_ALIAS } from "@/server/llm-gateway/catalog";
import { listConnectionModels } from "../http/providers/[id]/models/listConnectionModels";

/**
 * Keeps a provider's catalogue current without anybody pressing a button.
 *
 * Providers that answer a models endpoint ship no static list any more, so
 * something has to ask. That used to be the dashboard's "Refresh Models" and
 * nothing else — meaning a provider stayed invisible in the chat picker, in
 * combos, in smart routing and in `/v1/models` until a human opened its page.
 *
 * The answer is stored where the manual refresh already stores it — the
 * account's discovered custom models — so every reader picks it up unchanged.
 */

/** How long a discovered catalogue is trusted before it is asked for again. */
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

const meta = makeKv("meta");
// v2: discovery started storing each model's kind. Catalogues stamped before
// hold every model as "llm", and the model list now trusts the stored kind, so
// a new stamp makes every account rediscover once instead of hiding its image
// models until the old stamp expires.
const stampKey = (alias: string) => `catalogDiscoveredAt:v2:${alias}`;

/**
 * In-process guard against two requests discovering the same provider at once.
 *
 * ponytail: per-process, like the rate limiter beside it. Two serverless
 * instances can still both refresh a provider; the write is idempotent, so the
 * cost is a duplicate upstream call, not a wrong catalogue.
 */
const inFlight = new Map<string, Promise<void>>();

/**
 * Per-process memory of the last time an alias was checked.
 *
 * Without it, every `/v1/models` request would read one `kv` row per connected
 * provider just to learn that nothing is due — ~180ms each against Neon, paid
 * on a request that had no work to do.
 */
const checkedAt = new Map<string, number>();

async function discover(providerId: string, alias: string): Promise<void> {
  const connections = await getProviderConnections({ provider: providerId, isActive: true });
  const connection = connections[0];
  if (!connection) return;

  const result = await listConnectionModels(connection as unknown as Record<string, unknown>);
  if (result.error || !Array.isArray(result.models) || result.models.length === 0) return;

  const discovered = result.models.flatMap((model: unknown) => {
    if (!model || typeof model !== "object") return [];
    const entry = model as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : typeof entry.name === "string" ? entry.name : "";
    if (!id) return [];
    const type = discoveredModelKind(entry);
    if (!type) return [];
    return [{
      providerAlias: alias,
      id,
      type,
      name: typeof entry.name === "string" ? entry.name : id,
      source: "discovered" as const,
      metadata: pickDiscoveredMetadata(entry),
    }];
  });
  if (discovered.length === 0) return;

  await syncDiscoveredCustomModels(alias, discovered);
  await meta.set(stampKey(alias), Date.now());
}

/**
 * Discovers this provider's catalogue if nothing has in a while.
 *
 * Runs inside the caller's tenant context and never throws: a catalogue that
 * could not be refreshed is a stale catalogue, not a failed request.
 */
export async function ensureProviderCatalog(providerId: string): Promise<void> {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  // Both maps are keyed by account: a catalogue is discovered with one
  // account's credential and stored in its own rows, so another account's
  // provider must not be skipped because this one just checked.
  const key = `${currentTenantId()}:${alias}`;
  const running = inFlight.get(key);
  if (running) return running;

  if (Date.now() - (checkedAt.get(key) ?? 0) < CATALOG_TTL_MS) return;

  const task = (async () => {
    try {
      const stamp = Number(await meta.get<number>(stampKey(alias), 0)) || 0;
      checkedAt.set(key, stamp || Date.now());
      if (Date.now() - stamp < CATALOG_TTL_MS) return;
      await discover(providerId, alias);
      checkedAt.set(key, Date.now());
    } catch (error) {
      console.error(`[catalog] discovery failed for ${providerId}:`, error);
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}
