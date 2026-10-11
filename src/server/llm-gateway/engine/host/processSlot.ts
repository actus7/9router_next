// The bootstrap (instrumentation.ts) and the route handlers are separate
// bundles in Next, each with its own copy of a module: a module-level `let`
// filled by one is invisible to the other. A slot on globalThis is shared by
// every copy in the process — the seams below were installed and never seen.

export interface ProcessSlot<T> {
  get(): T | null;
  set(value: T | null): void;
}

export function processSlot<T>(name: string): ProcessSlot<T> {
  const key = Symbol.for(`modelhub.engine.host.${name}`);
  const g = globalThis as Record<symbol, unknown>;
  return {
    get: () => (g[key] as T | null | undefined) ?? null,
    set: (value) => { g[key] = value; },
  };
}
