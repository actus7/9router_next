import { describe, expect, it } from "vitest";
import {
  TTFT_BUCKET_EDGES_MS,
  adaptiveFirstByteBudget,
  aggregateModelStats,
  blendScores,
  ttftBucketIndex,
  type ModelPerfRow,
} from "@/shared/observability/modelStats";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const hourKeyAgo = (hours: number) => new Date(NOW - hours * HOUR).toISOString().slice(0, 13);

function row(over: Partial<ModelPerfRow> & { buckets?: Partial<Record<number, number>> }): ModelPerfRow {
  const b = Array.from({ length: TTFT_BUCKET_EDGES_MS.length + 1 }, (_, i) => over.buckets?.[i] ?? 0);
  return { modelKey: "a/m", hourKey: hourKeyAgo(0), ok: 0, fail: 0, timeout: 0, ...over, b };
}

describe("ttftBucketIndex", () => {
  it("places a duration in the first bucket whose edge it does not exceed", () => {
    expect(ttftBucketIndex(100)).toBe(0);
    expect(ttftBucketIndex(250)).toBe(0);
    expect(ttftBucketIndex(251)).toBe(1);
    expect(ttftBucketIndex(1000)).toBe(2);
    expect(ttftBucketIndex(10_000_000)).toBe(TTFT_BUCKET_EDGES_MS.length);
  });
});

describe("aggregateModelStats", () => {
  it("sums fresh hours and reads percentiles off the buckets", () => {
    // 90 fast (<=250ms) and 10 slow (<=16s): p50 fast, p95 slow.
    const stats = aggregateModelStats([row({ ok: 100, buckets: { 0: 90, 6: 10 } })], NOW);
    const s = stats.get("a/m")!;
    expect(s.okW).toBeCloseTo(100, 5);
    expect(s.p50Ms).toBe(250);
    expect(s.p95Ms).toBe(16_000);
    expect(s.ttftSamples).toBe(100);
  });

  it("halves a row's weight every two days", () => {
    const stats = aggregateModelStats([row({ hourKey: hourKeyAgo(48), ok: 10, fail: 10 })], NOW);
    expect(stats.get("a/m")!.okW).toBeCloseTo(5, 3);
    expect(stats.get("a/m")!.failW).toBeCloseTo(5, 3);
  });

  it("drops rows older than the window and keeps models apart", () => {
    const stats = aggregateModelStats([
      row({ hourKey: hourKeyAgo(24 * 8), ok: 50 }),
      row({ modelKey: "b/m", ok: 3 }),
    ], NOW);
    expect(stats.has("a/m")).toBe(false);
    expect(stats.get("b/m")!.okW).toBeCloseTo(3, 5);
  });
});

describe("blendScores", () => {
  const prior = { reliabilityScore: 0.72, latencyScore: 0.7 };

  it("is exactly the prior for a model with no data", () => {
    expect(blendScores(prior, undefined)).toEqual(prior);
  });

  it("lets a few samples nudge but not overturn the prior", () => {
    const stats = aggregateModelStats([row({ fail: 3 })], NOW).get("a/m")!;
    const blended = blendScores(prior, stats);
    expect(blended.reliabilityScore).toBeLessThan(0.72);
    expect(blended.reliabilityScore).toBeGreaterThan(0.4);
  });

  it("converges on the measured rate with plenty of data", () => {
    const stats = aggregateModelStats([row({ ok: 5, fail: 195 })], NOW).get("a/m")!;
    expect(blendScores(prior, stats).reliabilityScore).toBeLessThan(0.1);
    const good = aggregateModelStats([row({ ok: 400, fail: 0 })], NOW).get("a/m")!;
    expect(blendScores(prior, good).reliabilityScore).toBeGreaterThan(0.97);
  });

  it("scores latency from measured TTFT, weighted by how much was measured", () => {
    const fast = aggregateModelStats([row({ ok: 40, buckets: { 0: 40 } })], NOW).get("a/m")!;
    expect(blendScores({ ...prior, latencyScore: 0.1 }, fast).latencyScore).toBeGreaterThan(0.9);
    const slow = aggregateModelStats([row({ ok: 40, buckets: { 7: 40 } })], NOW).get("a/m")!;
    expect(blendScores({ ...prior, latencyScore: 0.9 }, slow).latencyScore).toBeLessThan(0.1);
    // Two samples barely move a confident prior.
    const few = aggregateModelStats([row({ ok: 2, buckets: { 7: 2 } })], NOW).get("a/m")!;
    expect(blendScores({ ...prior, latencyScore: 0.9 }, few).latencyScore).toBeGreaterThan(0.75);
  });
});

describe("adaptiveFirstByteBudget", () => {
  const BASE = 60_000;
  const statWith = (p95Ms: number | null, ttftSamples: number) =>
    ({ okW: 0, failW: 0, ttftW: ttftSamples, ttftSamples, p50Ms: p95Ms, p95Ms, samples: ttftSamples });

  it("keeps the base without enough history", () => {
    expect(adaptiveFirstByteBudget(BASE, undefined)).toBe(BASE);
    expect(adaptiveFirstByteBudget(BASE, statWith(50_000, 4))).toBe(BASE);
  });

  it("keeps the base for a model that is not slow", () => {
    expect(adaptiveFirstByteBudget(BASE, statWith(4000, 50))).toBe(BASE);
  });

  it("gives a historically slow model its p95 plus a buffer, capped at 3x", () => {
    expect(adaptiveFirstByteBudget(BASE, statWith(40_000, 50))).toBe(60_000);
    expect(adaptiveFirstByteBudget(BASE, statWith(64_000, 50))).toBe(74_000);
    expect(adaptiveFirstByteBudget(BASE, statWith(500_000, 50))).toBe(BASE * 3);
  });
});
