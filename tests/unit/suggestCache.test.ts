import { describe, expect, it } from "vitest";

/**
 * Suggestion cache partitioning: what makes an analyzed profile reusable and
 * what sends it back to the classifier. Pure — no clock, no I/O: callers pass
 * `now`, and `force` is deliberately not this function's concern (a forced run
 * arrives here as an empty cache).
 */

import {
  aaFingerprintOf,
  partitionByCache,
} from "@/server/application/use-cases/smart-routing/suggestProfiles";
import type { CachedSuggestion } from "@/lib/db/repos/suggestCacheRepo";
import type { AaModelMetrics, SmartModelProfile } from "@/shared/llm-catalog";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function profile(overrides: Partial<SmartModelProfile> = {}): SmartModelProfile {
  return {
    modelKey: "oc/claude-sonnet-4-5",
    provider: "oc",
    model: "claude-sonnet-4-5",
    displayName: "Claude Sonnet 4.5",
    capabilities: { serviceKinds: ["llm"], vision: false, pdf: false, audioInput: false, videoInput: false, imageOutput: false, audioOutput: false, tools: true, search: false, reasoning: false, contextWindow: 200_000, maxOutput: 64_000 },
    inputPrice: null,
    outputPrice: null,
    quality: 0.7,
    latencyScore: 0.7,
    reliabilityScore: 0.72,
    recommendedTier: "standard",
    needScores: {},
    source: "deterministic",
    inventoryFingerprint: "inv-1",
    ...overrides,
  };
}

function aaMetrics(overrides: Partial<AaModelMetrics> = {}): AaModelMetrics {
  return {
    aaId: "aa-1",
    slug: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    creator: "Anthropic",
    intelligence: 63,
    coding: 56,
    agentic: 48,
    math: 50,
    inputUsdPer1M: 3,
    outputUsdPer1M: 15,
    outputTokensPerSecond: 154,
    ttftSeconds: 0.9,
    benchmarkCostUsd: 0.5,
    ...overrides,
  };
}

function cacheEntry(overrides: Partial<CachedSuggestion> = {}): CachedSuggestion {
  return {
    analyzedAt: new Date(NOW - 60_000).toISOString(),
    inventoryFingerprint: "inv-1",
    aaFingerprint: null,
    suggestion: {
      quality: 0.8,
      latencyScore: 0.6,
      reliabilityScore: 0.9,
      recommendedTier: "complex",
      needScores: { coding: 0.7 },
      sources: [],
    },
    ...overrides,
  };
}

describe("partitionByCache", () => {
  it("marks a hit fresh when age, inventory and AA fingerprints all match", () => {
    const withAa = profile({ aa: aaMetrics() });
    const withoutAa = profile({ modelKey: "oc/other", inventoryFingerprint: "inv-2" });
    const cache = {
      [withAa.modelKey]: cacheEntry({ aaFingerprint: aaFingerprintOf(withAa) }),
      [withoutAa.modelKey]: cacheEntry({ inventoryFingerprint: "inv-2" }),
    };

    const { fresh, stale } = partitionByCache([withAa, withoutAa], cache, { now: NOW, ttlMs: TTL_MS });

    expect(fresh.map((hit) => hit.profile.modelKey)).toEqual([withAa.modelKey, withoutAa.modelKey]);
    // The cached suggestion travels with the hit — same shape classifyBatch produced.
    expect(fresh[0].cached.suggestion.recommendedTier).toBe("complex");
    expect(stale).toEqual([]);
  });

  it("sends a profile back to analysis once the TTL expires", () => {
    const target = profile();
    const inside = cacheEntry({ analyzedAt: new Date(NOW - TTL_MS + 1_000).toISOString() });
    // `analyzedAt + ttl > now` is strict: the boundary second is already stale.
    const boundary = cacheEntry({ analyzedAt: new Date(NOW - TTL_MS).toISOString() });

    expect(partitionByCache([target], { [target.modelKey]: inside }, { now: NOW, ttlMs: TTL_MS }).fresh).toHaveLength(1);

    const { fresh, stale } = partitionByCache([target], { [target.modelKey]: boundary }, { now: NOW, ttlMs: TTL_MS });
    expect(fresh).toEqual([]);
    expect(stale).toEqual([target]);
  });

  it("sends a profile back when the inventory fingerprint changed", () => {
    const target = profile({ inventoryFingerprint: "inv-2" });
    const cache = { [target.modelKey]: cacheEntry({ inventoryFingerprint: "inv-1" }) };

    const { fresh, stale } = partitionByCache([target], cache, { now: NOW, ttlMs: TTL_MS });
    expect(fresh).toEqual([]);
    expect(stale).toEqual([target]);
  });

  it("sends a profile back when the AA fingerprint changed", () => {
    const target = profile({ aa: aaMetrics({ intelligence: 63 }) });
    // Cached against another snapshot of the same model's metrics.
    const cache = {
      [target.modelKey]: cacheEntry({ aaFingerprint: aaFingerprintOf(profile({ aa: aaMetrics({ intelligence: 48 }) })) }),
    };

    const { fresh, stale } = partitionByCache([target], cache, { now: NOW, ttlMs: TTL_MS });
    expect(fresh).toEqual([]);
    expect(stale).toEqual([target]);
  });

  it("treats a missing AA fingerprint and a present one as different on either side", () => {
    const withAa = profile({ modelKey: "oc/with-aa", aa: aaMetrics() });
    // Analyzed without AA metrics, now enriched by a snapshot match.
    const gainedAa = partitionByCache(
      [withAa],
      { [withAa.modelKey]: cacheEntry({ aaFingerprint: null }) },
      { now: NOW, ttlMs: TTL_MS },
    );
    expect(gainedAa.stale).toEqual([withAa]);

    const withoutAa = profile({ modelKey: "oc/without-aa" });
    // Analyzed with AA metrics that no longer match.
    const lostAa = partitionByCache(
      [withoutAa],
      { [withoutAa.modelKey]: cacheEntry({ aaFingerprint: aaFingerprintOf(profile({ modelKey: "oc/without-aa", aa: aaMetrics() })) }) },
      { now: NOW, ttlMs: TTL_MS },
    );
    expect(lostAa.stale).toEqual([withoutAa]);
    expect(gainedAa.fresh).toEqual([]);
    expect(lostAa.fresh).toEqual([]);
  });

  it("treats an unparseable analyzedAt as stale", () => {
    const target = profile();
    const cache = { [target.modelKey]: cacheEntry({ analyzedAt: "not-a-date" }) };

    expect(partitionByCache([target], cache, { now: NOW, ttlMs: TTL_MS }).stale).toEqual([target]);
  });

  it("has no force option — a forced run passes an empty cache", () => {
    const target = profile();
    const cache = { [target.modelKey]: cacheEntry() };

    expect(partitionByCache([target], cache, { now: NOW, ttlMs: TTL_MS }).fresh).toHaveLength(1);
    // Bypassing the cache is the caller's job; what lands here is an empty map.
    expect(partitionByCache([target], {}, { now: NOW, ttlMs: TTL_MS }).stale).toEqual([target]);
  });

  it("partitions a mixed batch without reordering either side", () => {
    const a = profile({ modelKey: "oc/a", inventoryFingerprint: "inv-a" });
    const b = profile({ modelKey: "oc/b", inventoryFingerprint: "inv-b" });
    const c = profile({ modelKey: "oc/c", inventoryFingerprint: "inv-c" });
    const cache = {
      [a.modelKey]: cacheEntry({ inventoryFingerprint: "inv-a" }),
      [c.modelKey]: cacheEntry({ inventoryFingerprint: "inv-c" }),
    };

    const { fresh, stale } = partitionByCache([a, b, c], cache, { now: NOW, ttlMs: TTL_MS });
    expect(fresh.map((hit) => hit.profile.modelKey)).toEqual(["oc/a", "oc/c"]);
    expect(stale.map((entry) => entry.modelKey)).toEqual(["oc/b"]);
  });
});

describe("aaFingerprintOf", () => {
  it("is null for a profile without AA metrics", () => {
    expect(aaFingerprintOf(profile())).toBeNull();
  });

  it("digests the AA metrics stably — key order does not matter", () => {
    const forward = aaMetrics();
    const backward: AaModelMetrics = {
      ttftSeconds: forward.ttftSeconds,
      benchmarkCostUsd: forward.benchmarkCostUsd,
      outputTokensPerSecond: forward.outputTokensPerSecond,
      outputUsdPer1M: forward.outputUsdPer1M,
      inputUsdPer1M: forward.inputUsdPer1M,
      math: forward.math,
      agentic: forward.agentic,
      coding: forward.coding,
      intelligence: forward.intelligence,
      creator: forward.creator,
      name: forward.name,
      slug: forward.slug,
      aaId: forward.aaId,
    };

    const left = aaFingerprintOf(profile({ aa: forward }));
    const right = aaFingerprintOf(profile({ aa: backward }));

    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when any metric changes", () => {
    const base = aaFingerprintOf(profile({ aa: aaMetrics() }));
    expect(aaFingerprintOf(profile({ aa: aaMetrics({ intelligence: 64 }) }))).not.toBe(base);
  });
});
