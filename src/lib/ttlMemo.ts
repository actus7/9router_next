/**
 * Per-process memo with a TTL, for reads that sit on the gateway hot path.
 *
 * Keys are chosen by the caller and MUST carry the tenant (or be globally
 * unique, like an API key): this class knows nothing about accounts.
 * Writes through the owning repo call `delete`/`clear`; another instance's
 * write is seen within `ttlMs`.
 *
 * A read that races a write: capture `generation` before the SELECT and pass it
 * to `set`. An invalidation bumps it, so the read's older row is dropped instead
 * of being cached for the whole TTL.
 */
export class TtlMemo<V> {
  private readonly entries = new Map<string, { at: number; value: V }>();
  private invalidations = 0;

  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  /** Bumped by every `delete`/`clear`; capture it before a read, hand it back to `set`. */
  get generation(): number {
    return this.invalidations;
  }

  set(key: string, value: V, readAtGeneration?: number): void {
    if (readAtGeneration !== undefined && readAtGeneration !== this.invalidations) return;
    this.entries.set(key, { at: Date.now(), value });
  }

  delete(key: string): void {
    this.invalidations++;
    this.entries.delete(key);
  }

  clear(): void {
    this.invalidations++;
    this.entries.clear();
  }
}
