// What the gateway has measured about each model from its own traffic, turned
// into the two numbers the smart ranking already uses (reliability, latency)
// and into a patience for the first byte. Pure functions over aggregated rows:
// the engine never reads the database, an installed store hands it the rows
// (see host/modelStats.ts).
//
// The ranking's old numbers were a constant (reliability 0.72 for everyone) and
// a regex on the model name (latency). Both stay as the PRIOR: a model nobody
// has measured behaves exactly as before, and a handful of samples nudges the
// prior instead of overturning it.

export const TTFT_BUCKET_EDGES_MS = [250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000] as const;
export const TTFT_BUCKETS = TTFT_BUCKET_EDGES_MS.length + 1;

/** Past the last edge a duration is "very slow"; this stands in for its value. */
const OVERFLOW_BUCKET_MS = 120_000;

export const STATS_WINDOW_MS = 7 * 24 * 3_600_000;
export const STATS_HALF_LIFE_MS = 2 * 24 * 3_600_000;

/** Pseudo-observations the prior is worth. */
const PRIOR_STRENGTH = 5;
/** Decay-weighted TTFT samples after which the measurement fully replaces the latency prior. */
const LATENCY_FULL_SAMPLES = 20;
const TTFB_BEST_MS = 300;
const TTFB_WORST_MS = 5000;

const ADAPTIVE_MIN_SAMPLES = 5;
const ADAPTIVE_BUFFER_MS = 10_000;
const ADAPTIVE_MAX_MULTIPLIER = 3;
const ADAPTIVE_SLOW_FRACTION = 0.5;
const FAST_BUDGET_FLOOR_MS = 8_000;
const FAST_BUDGET_MULTIPLIER = 3;

const HEDGE_MIN_DELAY_MS = 5_000;
const HEDGE_MAX_DELAY_MS = 8_000;
const HEDGE_DEFAULT_DELAY_MS = 6_000;
const HEDGE_REASONING_DELAY_MS = 15_000;

export interface ModelPerfRow {
  modelKey: string;
  /** UTC hour, `YYYY-MM-DDTHH`. */
  hourKey: string;
  ok: number;
  /** Every failure, timeouts included. */
  fail: number;
  timeout: number;
  /** Successful-attempt time-to-first-response, as bucket counts. */
  b: number[];
}

export interface ModelStat {
  okW: number;
  failW: number;
  ttftW: number;
  /** Raw (undecayed) count behind the percentiles. */
  ttftSamples: number;
  /** Raw count of ok + failed attempts. */
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface ScorePrior {
  reliabilityScore: number;
  latencyScore: number;
}

export function ttftBucketIndex(ms: number): number {
  const index = TTFT_BUCKET_EDGES_MS.findIndex((edge) => ms <= edge);
  return index === -1 ? TTFT_BUCKET_EDGES_MS.length : index;
}

function bucketValue(index: number): number {
  return TTFT_BUCKET_EDGES_MS[index] ?? OVERFLOW_BUCKET_MS;
}

function percentile(weights: number[], total: number, quantile: number): number | null {
  if (total <= 0) return null;
  const target = total * quantile;
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (cumulative >= target) return bucketValue(i);
  }
  return bucketValue(weights.length - 1);
}

function hourStartMs(hourKey: string): number {
  return Date.parse(`${hourKey}:00:00Z`);
}

/** Decay-weighted totals per model over the last 7 days (2-day half-life). */
export function aggregateModelStats(rows: ModelPerfRow[], now: number = Date.now()): Map<string, ModelStat> {
  const acc = new Map<string, { okW: number; failW: number; buckets: number[]; ttftSamples: number; samples: number }>();
  for (const row of rows) {
    const age = now - hourStartMs(row.hourKey);
    if (!Number.isFinite(age) || age > STATS_WINDOW_MS) continue;
    const weight = Math.pow(0.5, Math.max(0, age) / STATS_HALF_LIFE_MS);
    let entry = acc.get(row.modelKey);
    if (!entry) acc.set(row.modelKey, entry = { okW: 0, failW: 0, buckets: new Array(TTFT_BUCKETS).fill(0), ttftSamples: 0, samples: 0 });
    entry.okW += row.ok * weight;
    entry.failW += row.fail * weight;
    entry.samples += row.ok + row.fail;
    row.b.forEach((count, i) => {
      entry!.buckets[i] += count * weight;
      entry!.ttftSamples += count;
    });
  }
  const result = new Map<string, ModelStat>();
  for (const [modelKey, entry] of acc) {
    const ttftW = entry.buckets.reduce((sum, w) => sum + w, 0);
    result.set(modelKey, {
      okW: entry.okW,
      failW: entry.failW,
      ttftW,
      ttftSamples: entry.ttftSamples,
      samples: entry.samples,
      p50Ms: percentile(entry.buckets, ttftW, 0.5),
      p95Ms: percentile(entry.buckets, ttftW, 0.95),
    });
  }
  return result;
}

function ttfbScore(ms: number): number {
  return Math.max(0, Math.min(1, 1 - (ms - TTFB_BEST_MS) / (TTFB_WORST_MS - TTFB_BEST_MS)));
}

/**
 * The prior, pulled toward what was measured. Reliability is a Beta-style
 * posterior mean with the prior worth PRIOR_STRENGTH observations; latency
 * blends the prior with a TTFT-derived score, weighted by how much was seen.
 */
export function blendScores(prior: ScorePrior, stat: ModelStat | undefined): ScorePrior {
  if (!stat) return prior;
  const reliabilityScore =
    (prior.reliabilityScore * PRIOR_STRENGTH + stat.okW) / (PRIOR_STRENGTH + stat.okW + stat.failW);
  const measured = stat.p50Ms === null ? null : ttfbScore(stat.p50Ms);
  const weight = Math.min(1, stat.ttftW / LATENCY_FULL_SAMPLES);
  const latencyScore = measured === null ? prior.latencyScore : (1 - weight) * prior.latencyScore + weight * measured;
  return { reliabilityScore, latencyScore };
}

/**
 * How long to wait for a model's first byte. A model that has historically been
 * slow to start gets its own p95 plus a buffer (never above 3x the base, so one
 * lucky success cannot triple its patience). A model that has been fast gets
 * 3x its p95 (floored at 8s, capped at the base), so a dead one is given up on
 * in seconds instead of a minute. Without enough history it is the base.
 */
export function adaptiveFirstByteBudget(baseMs: number, stat: ModelStat | undefined): number {
  if (!stat || stat.p95Ms === null || stat.ttftSamples < ADAPTIVE_MIN_SAMPLES) return baseMs;
  if (stat.p95Ms < baseMs * ADAPTIVE_SLOW_FRACTION) {
    return Math.min(baseMs, Math.max(FAST_BUDGET_FLOOR_MS, stat.p95Ms * FAST_BUDGET_MULTIPLIER));
  }
  return Math.max(baseMs, Math.min(stat.p95Ms + ADAPTIVE_BUFFER_MS, baseMs * ADAPTIVE_MAX_MULTIPLIER));
}

/**
 * How long a combo waits for a model's first byte before also starting the next
 * candidate (a hedge). 2x the typical TTFT, kept between 5s and 8s; a reasoning
 * model thinks silently on purpose, so it is given far longer.
 */
export function hedgeDelayMs(stat: ModelStat | undefined, isReasoning: boolean): number {
  if (isReasoning) return HEDGE_REASONING_DELAY_MS;
  if (!stat || stat.p50Ms === null || stat.ttftSamples < ADAPTIVE_MIN_SAMPLES) return HEDGE_DEFAULT_DELAY_MS;
  return Math.min(HEDGE_MAX_DELAY_MS, Math.max(HEDGE_MIN_DELAY_MS, stat.p50Ms * 2));
}
