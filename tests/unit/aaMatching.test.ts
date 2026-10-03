import { describe, expect, it } from "vitest";

/**
 * Artificial Analysis matching: the normalization that equates the two ways of
 * spelling a version, the model/displayName lookup, and the enrichment rule
 * that only ever *fills* prices. Everything here is fail-open by construction —
 * a null snapshot must leave the inventory byte-identical.
 */

import {
  baseModelName,
  enrichProfilesWithAa,
  indexAaModels,
  matchAaToProfile,
  normalizeModelName,
  type AaSnapshot,
} from "@/server/application/use-cases/smart-routing/artificialAnalysis";
import type { AaModelMetrics, SmartModelProfile } from "@/shared/llm-catalog";

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
    inventoryFingerprint: "test",
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

const snapshot: AaSnapshot = {
  meta: { fetchedAt: "2026-10-01T00:00:00.000Z", indexVersion: 3, tier: "free", modelCount: 1 },
  byNormName: { claudesonnet45: aaMetrics() },
};

describe("normalizeModelName", () => {
  it("equates punctuation and version spellings of the same model", () => {
    expect(normalizeModelName("Claude Sonnet 4.5")).toBe("claudesonnet45");
    expect(normalizeModelName("claude-sonnet-4-5")).toBe("claudesonnet45");
    // Same trick for dots/dashes mixed with case and stray separators.
    expect(normalizeModelName("GEMINI 2.5/Pro!")).toBe(normalizeModelName("gemini-2-5-pro"));
  });

  it("drops everything outside [a-z0-9] and survives empty input", () => {
    expect(normalizeModelName("gpt-5.1 (2026)")).toBe("gpt512026");
    expect(normalizeModelName("")).toBe("");
  });
});

describe("matchAaToProfile", () => {
  it("matches on the model id when normalization equates the spellings", () => {
    expect(matchAaToProfile(profile(), snapshot.byNormName)?.aaId).toBe("aa-1");
  });

  it("falls back to displayName when the model id is provider-prefixed", () => {
    const prefixed = profile({ model: "anthropic/claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5" });
    expect(matchAaToProfile(prefixed, snapshot.byNormName)?.slug).toBe("claude-sonnet-4-5");
  });

  it("returns undefined when neither name is in the snapshot", () => {
    expect(matchAaToProfile(profile({ model: "totally-unknown", displayName: "Also Unknown" }), snapshot.byNormName)).toBeUndefined();
  });
});

describe("enrichProfilesWithAa", () => {
  it("attaches metrics and fills only the prices that are null", () => {
    const catalogPriced = profile({ inputPrice: 2.5, outputPrice: null });
    const result = enrichProfilesWithAa([catalogPriced], snapshot);

    const enriched = result.profiles[0];
    expect(enriched.aa?.intelligence).toBe(63);
    // The catalog price stays: AA is an aggregated reference, never a replacement.
    expect(enriched.inputPrice).toBe(2.5);
    expect(enriched.outputPrice).toBe(15);
    expect(result.matched).toBe(1);
    expect(result.total).toBe(1);
  });

  it("leaves a price null when neither the catalog nor AA has one", () => {
    const emptyPrices: AaSnapshot = {
      ...snapshot,
      byNormName: { claudesonnet45: aaMetrics({ inputUsdPer1M: null, outputUsdPer1M: null }) },
    };
    const enriched = enrichProfilesWithAa([profile()], emptyPrices).profiles[0];

    expect(enriched.inputPrice).toBeNull();
    expect(enriched.outputPrice).toBeNull();
    expect(enriched.aa?.inputUsdPer1M).toBeNull();
  });

  it("counts matches per profile and skips profiles without one", () => {
    const unknown = profile({ model: "unknown-model", displayName: "Unknown Model", modelKey: "oc/unknown" });
    const result = enrichProfilesWithAa([profile(), unknown], snapshot);

    expect(result.matched).toBe(1);
    expect(result.total).toBe(2);
    expect(result.profiles[1].aa).toBeUndefined();
    expect(result.profiles[1].inputPrice).toBeNull();
  });

  it("returns everything intact when the snapshot is null", () => {
    const profiles = [profile({ inputPrice: 2.5 })];
    const result = enrichProfilesWithAa(profiles, null);

    expect(result.profiles).toBe(profiles);
    expect(result.matched).toBe(0);
    expect(result.total).toBe(1);
    expect(result.profiles[0]).toEqual(profiles[0]);
  });
});

describe("baseModelName", () => {
  it("strips AA classification suffixes but keeps sizes and product names", () => {
    expect(baseModelName("Gemini 2.5 Flash (Reasoning)")).toBe("gemini25flash");
    expect(baseModelName("Gemini 2.5 Flash-Lite (Non-reasoning)")).toBe("gemini25flashlite");
    expect(baseModelName("Claude Opus 4.7 (Non-reasoning, High)")).toBe("claudeopus47");
    expect(baseModelName("Claude Opus 5.5 Max (Default Fallback)")).toBe("claudeopus55max");
    // Sizes and product names are part of the model — never stripped.
    expect(baseModelName("Qwen 3.5 122B-A10B (Non-reasoning)")).toBe("qwen35122ba10b");
    expect(baseModelName("qwen3-max-thinking")).toBe("qwen3maxthinking");
  });

  it("leaves unclassified names alone and never strips below four characters", () => {
    expect(baseModelName("gemini-2.5-flash")).toBe("gemini25flash");
    expect(baseModelName("low")).toBe("low");
    expect(baseModelName("")).toBe("");
  });
});

describe("indexAaModels", () => {
  const reasoning = aaMetrics({ name: "Gemini 2.5 Flash (Reasoning)", slug: "gemini-2.5-flash-reasoning", intelligence: 55 });
  const nonReasoning = aaMetrics({ name: "Gemini 2.5 Flash (Non-reasoning)", slug: "gemini-2.5-flash-non-reasoning", intelligence: 48 });
  const plain = aaMetrics({ name: "Qwen3-Max", slug: "qwen3-max", intelligence: 30 });
  const thinking = aaMetrics({ name: "Qwen3-Max-Thinking", slug: "qwen3-max-thinking", intelligence: 42 });

  it("keeps full keys for exact matching and adds base keys for classified rows", () => {
    const index = indexAaModels([reasoning, nonReasoning]);

    expect(index.gemini25flashreasoning).toBe(reasoning);
    expect(index.gemini25flashnonreasoning).toBe(nonReasoning);
    expect(index.gemini25flash).toBe(nonReasoning);
  });

  it("prefers the plain row for a base key, then the non-reasoning variant", () => {
    expect(indexAaModels([reasoning, nonReasoning, plain]).qwen3max).toBe(plain);
    // No plain row: the conservative non-reasoning variant represents the base.
    expect(indexAaModels([reasoning, nonReasoning]).gemini25flash).toBe(nonReasoning);
    // Only a reasoning row exists: it still matches the base.
    expect(indexAaModels([reasoning]).gemini25flash).toBe(reasoning);
  });

  it("does not let a classified row steal a plain row's own key", () => {
    const index = indexAaModels([thinking, plain]);
    expect(index.qwen3max).toBe(plain);
    expect(index.qwen3maxthinking).toBe(thinking);
  });
});

describe("matchAaToProfile against classified AA rows", () => {
  const rows = indexAaModels([
    aaMetrics({ name: "Gemini 2.5 Flash (Reasoning)", slug: "gemini-2.5-flash-reasoning", intelligence: 55 }),
    aaMetrics({ name: "Gemini 2.5 Flash (Non-reasoning)", slug: "gemini-2.5-flash-non-reasoning", intelligence: 48 }),
    aaMetrics({ name: "Claude Opus 4.7 (Non-reasoning, High)", slug: "claude-opus-4-7", intelligence: 71 }),
  ]);

  it("matches a catalog id without the suffix through the base key", () => {
    const found = matchAaToProfile(profile({ model: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }), rows);
    expect(found?.intelligence).toBe(48);
  });

  it("prefers AA's reasoning variant for a reasoning-column profile", () => {
    const found = matchAaToProfile(profile({ model: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", recommendedTier: "reasoning" }), rows);
    expect(found?.intelligence).toBe(55);
  });

  it("matches multi-suffix rows (non-reasoning + level) by base name", () => {
    const found = matchAaToProfile(profile({ model: "claude-opus-4.7", displayName: "Claude Opus 4.7" }), rows);
    expect(found?.intelligence).toBe(71);
  });
});
