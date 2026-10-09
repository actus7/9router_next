import "server-only";

import { clearModelPerf, readModelPerf } from "@/lib/db/repos/modelPerfRepo";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { clearAllModelAvailability, getActiveModelAvailability } from "@/lib/db/repos/modelAvailabilityRepo";
import { getProviderAlias } from "@/shared/constants/providers";
import { aggregateModelStats } from "@/shared/observability/modelStats";
import { resetModelStatsCache } from "@/server/llm-gateway/application/modelStatsStore";
import { clearTenantModelBench } from "@/server/llm-gateway/auth/modelBench";
import { clearModelPenalties, snapshotModelPenalties } from "@/server/llm-gateway/engine/services/modelPenalty";

export type ModelHealthState = "ok" | "penalized" | "partial" | "cooldown";

export interface ModelHealthRow {
  model: string;
  state: ModelHealthState;
  /** Order penalty from recent failures, 0-10 (fades by itself). */
  penalty: number;
  /** Share of attempts that succeeded over the last week, recent ones weighing more; null when unmeasured. */
  successRate: number | null;
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
  accounts: number;
  cooldownAccounts: number;
  /** When the first cooling account frees up. */
  cooldownUntil?: string;
  reason?: string;
  errorCode?: number | null;
}

const SEVERITY: Record<ModelHealthState, number> = { cooldown: 0, partial: 1, penalized: 2, ok: 3 };

interface Cooling { count: number; until: string; reason: string; errorCode: number | null }

/** What the gateway currently thinks of every model it has seen for this account. */
export async function getModelHealth(): Promise<ModelHealthRow[]> {
  const [perf, connections, availability] = await Promise.all([
    readModelPerf(),
    getProviderConnections(),
    getActiveModelAvailability(),
  ]);
  const stats = aggregateModelStats(perf);
  const penalties = new Map(snapshotModelPenalties().map((p) => [p.model, p.penalty]));

  const aliasOfConnection = new Map(connections.map((c) => [c.id, getProviderAlias(String(c.provider))]));
  const accountsByAlias = new Map<string, number>();
  for (const alias of aliasOfConnection.values()) accountsByAlias.set(alias, (accountsByAlias.get(alias) ?? 0) + 1);

  const cooling = new Map<string, Cooling>();
  for (const row of availability) {
    const alias = aliasOfConnection.get(row.connectionId);
    // A whole-connection lock (`__all`) is the account's problem, not a model's.
    if (!alias || row.modelId === "__all" || !row.until) continue;
    const key = `${alias}/${row.modelId}`;
    const current = cooling.get(key);
    if (!current) cooling.set(key, { count: 1, until: row.until, reason: row.reason, errorCode: row.errorCode });
    else cooling.set(key, { ...current, count: current.count + 1, ...(row.until < current.until ? { until: row.until, reason: row.reason, errorCode: row.errorCode } : {}) });
  }

  const models = new Set([...stats.keys(), ...penalties.keys(), ...cooling.keys()]);
  const rows: ModelHealthRow[] = [...models].map((model) => {
    const stat = stats.get(model);
    const penalty = penalties.get(model) ?? 0;
    const cool = cooling.get(model);
    const accounts = accountsByAlias.get(model.slice(0, model.indexOf("/"))) ?? 0;
    const attempts = stat ? stat.okW + stat.failW : 0;
    const state: ModelHealthState = cool
      ? (accounts > 0 && cool.count >= accounts ? "cooldown" : "partial")
      : penalty > 0 ? "penalized" : "ok";
    return {
      model,
      state,
      penalty,
      successRate: stat && attempts > 0 ? stat.okW / attempts : null,
      samples: stat?.samples ?? 0,
      p50Ms: stat?.p50Ms ?? null,
      p95Ms: stat?.p95Ms ?? null,
      accounts,
      cooldownAccounts: cool?.count ?? 0,
      ...(cool ? { cooldownUntil: cool.until, reason: cool.reason, errorCode: cool.errorCode } : {}),
    };
  });
  return rows.sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state] || b.penalty - a.penalty || a.model.localeCompare(b.model));
}

/**
 * The operator's "start from a clean slate": forgets order penalties, the
 * measurements behind them and every model cooldown. A pool stuck behind long
 * cooldowns is also sunk by penalties, and lifting one without the other leaves
 * the router still avoiding the same models.
 */
export async function resetModelHealth(): Promise<{ penalties: number; cooldowns: number }> {
  const penalties = clearModelPenalties();
  clearTenantModelBench();
  resetModelStatsCache();
  await clearModelPerf();
  const cooldowns = await clearAllModelAvailability();
  return { penalties, cooldowns };
}
