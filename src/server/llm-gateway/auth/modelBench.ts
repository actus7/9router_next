import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { getActiveModelAvailability, setModelAvailability } from "@/lib/db/repos/modelAvailabilityRepo";
import { tryCurrentTenantId } from "@/lib/db/tenant";

// A cooldown is per account and model, so a model that is sick upstream with
// three accounts gets found out three times, one failed request each. This is
// the model-level counterpart: a sliding window of failures across accounts,
// and once the streak is convincing the whole model sits out on every account.
// It recovers on its own when the bench expires and one success clears the
// streak. Same shape (3 in 15 min -> 10 min) as the freellmapi router.
export const MODEL_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const MODEL_FAILURE_THRESHOLD = 3;
export const MODEL_BENCH_COOLDOWN_MS = 10 * 60 * 1000;

const failures = new Map<string, number[]>();

const keyOf = (provider: string, model: string): string => `${tryCurrentTenantId() ?? "-"}|${provider}/${model}`;

export function resetModelBench(): void {
  failures.clear();
}

/** Forgets this account's failure streaks (the operator's "clean slate"). */
export function clearTenantModelBench(): void {
  const prefix = `${tryCurrentTenantId() ?? "-"}|`;
  for (const key of [...failures.keys()]) if (key.startsWith(prefix)) failures.delete(key);
}

/** A request served is proof the model works: forget the streak. */
export function noteBenchSuccess(provider: string, model: string): void {
  failures.delete(keyOf(provider, model));
}

/**
 * Record one retryable failure of a model. At the threshold, bench the model on
 * every active account of the provider, never shortening a cooldown an account
 * already serves. Resolves true when it benched. Never throws: a bookkeeping
 * failure must not replace the upstream error the caller is handling.
 */
export async function noteBenchFailure(provider: string, model: string, status: number, now: number = Date.now()): Promise<boolean> {
  try {
    const key = keyOf(provider, model);
    const window = (failures.get(key) ?? []).filter((at) => now - at < MODEL_FAILURE_WINDOW_MS);
    window.push(now);
    failures.set(key, window);
    if (window.length < MODEL_FAILURE_THRESHOLD) return false;

    const benchUntilMs = now + MODEL_BENCH_COOLDOWN_MS;
    const accounts = (await getProviderConnections({ provider, isActive: true })) as Array<{ id: string }>;
    if (accounts.length === 0) return false;
    const active = await getActiveModelAvailability(accounts.map((account) => account.id), model);
    const servedUntil = new Map(active.map((row) => [row.connectionId, row.until ? Date.parse(row.until) : 0]));

    const until = new Date(benchUntilMs).toISOString();
    for (const account of accounts) {
      if ((servedUntil.get(account.id) ?? 0) >= benchUntilMs) continue;
      await setModelAvailability({
        connectionId: account.id,
        modelId: model,
        status: "cooldown",
        reason: "transient",
        errorCode: status || null,
        lastError: `Benched: ${MODEL_FAILURE_THRESHOLD} failures in ${Math.round(MODEL_FAILURE_WINDOW_MS / 60_000)} min`,
        until,
      });
    }
    failures.delete(key);
    return true;
  } catch {
    return false;
  }
}
