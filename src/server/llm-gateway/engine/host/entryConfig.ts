// What a combo lane entry asks of one attempt: the account it must run on and
// the request parameters it fixes. The combo knows which entry an attempt is;
// the code that fetches credentials and builds the provider body, several
// layers down, does not — so the config rides the attempt's body, the way the
// perf key does (a spread copy carries symbols, so a hedged copy keeps it).

export interface EntryConfig {
  /** Strict: the attempt runs on this account or fails. */
  connectionId?: string;
  /** Values by catalog path, merged into the provider request (see modelParams). */
  params?: Record<string, string | number | boolean | null>;
}

const ENTRY_CONFIG = Symbol.for("routerx.entryConfig");

export function setEntryConfig(body: Record<string, unknown>, config: EntryConfig | undefined): void {
  if (config === undefined) delete (body as Record<symbol, unknown>)[ENTRY_CONFIG];
  else (body as Record<symbol, unknown>)[ENTRY_CONFIG] = config;
}

export function getEntryConfig(body: Record<string, unknown> | null | undefined): EntryConfig | undefined {
  const config = body ? (body as Record<symbol, unknown>)[ENTRY_CONFIG] : undefined;
  return config && typeof config === "object" ? (config as EntryConfig) : undefined;
}

/** Per model, the config of each of its lane entries, in lane order. */
export type EntryConfigs = ReadonlyMap<string, ReadonlyArray<EntryConfig | undefined>>;

const ENTRY_CONFIGS = Symbol.for("routerx.entryConfigs");

/** The smart router attaches what it resolved to the request, like its routing decision. */
export function attachEntryConfigs(body: Record<string, unknown>, configs: EntryConfigs): void {
  if (configs.size > 0) (body as Record<symbol, unknown>)[ENTRY_CONFIGS] = configs;
}

/**
 * Hands attempt `index` of `candidates` its entry's config. The nth attempt of a
 * model uses its nth entry, so two entries of one model — one per account — keep
 * their own account however the order was rearranged (equal strings keep their
 * relative order). Set on every attempt, even to nothing: a shared body would
 * otherwise carry the previous entry's account.
 */
export function applyEntryConfig(body: Record<string, unknown>, candidates: readonly string[], index: number): void {
  const configs = (body as Record<symbol, unknown>)[ENTRY_CONFIGS] as EntryConfigs | undefined;
  const model = candidates[index];
  const occurrence = candidates.slice(0, index).filter((candidate) => candidate === model).length;
  setEntryConfig(body, configs?.get(model)?.[occurrence]);
}
