export interface ModelTestLatency {
  latencyMs: number;
  testedAt: string;
}

type SortableModel = { id: string; name: string };

const STORAGE_KEY = "routerx:model-test-latencies:v1";

export function modelTestLatencyKey(providerAlias: string, modelId: string): string {
  const alias = providerAlias.trim().toLowerCase();
  const rawModelId = modelId.trim();
  const model = rawModelId.toLowerCase().startsWith(`${alias}/`)
    ? rawModelId.slice(alias.length + 1)
    : rawModelId;
  return `${alias}/${model}`.toLowerCase();
}

export function getStoredModelTestLatencies(): Record<string, ModelTestLatency> {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
      const record = entry as Partial<ModelTestLatency> | null;
      return typeof record?.latencyMs === "number" && Number.isFinite(record.latencyMs) && record.latencyMs >= 0
        ? [[key, { latencyMs: record.latencyMs, testedAt: typeof record.testedAt === "string" ? record.testedAt : "" }]]
        : [];
    }));
  } catch {
    return {};
  }
}

export function saveModelTestLatency(providerAlias: string, modelId: string, latencyMs: unknown): void {
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs) || latencyMs < 0 || typeof window === "undefined") return;
  try {
    const latencies = getStoredModelTestLatencies();
    latencies[modelTestLatencyKey(providerAlias, modelId)] = { latencyMs, testedAt: new Date().toISOString() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(latencies));
  } catch {
    // Ordering is a convenience. A blocked browser storage must not affect model tests.
  }
}

export function sortModelsByTestLatency<T extends SortableModel>(
  models: readonly T[],
  latencies: Record<string, ModelTestLatency>,
): T[] {
  return [...models].sort((a, b) => {
    const aLatency = latencies[a.id.toLowerCase()]?.latencyMs;
    const bLatency = latencies[b.id.toLowerCase()]?.latencyMs;
    const aTested = typeof aLatency === "number";
    const bTested = typeof bLatency === "number";
    if (aTested && bTested && aLatency !== bLatency) return aLatency - bLatency;
    if (aTested !== bTested) return aTested ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
