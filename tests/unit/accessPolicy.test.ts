import { describe, expect, it } from "vitest";

import {
  filterAllowed,
  isUnrestricted,
  layersAllow,
  layersRestrict,
  matchesPattern,
  normalizeAccessPolicy,
  parseStoredAccessPolicy,
} from "@/shared/access/accessPolicy";

describe("normalizeAccessPolicy", () => {
  it("keeps only the three lists, trimmed and deduplicated", () => {
    expect(normalizeAccessPolicy({ models: [" cx/* ", "cx/*", "", 3], skills: ["a"], extra: ["x"] })).toEqual({
      models: ["cx/*"],
      skills: ["a"],
    });
  });

  it("reads a missing or non-list field as no restriction, and an empty list as nothing", () => {
    expect(normalizeAccessPolicy({ models: null, plugins: [] })).toEqual({ plugins: [] });
    expect(isUnrestricted(normalizeAccessPolicy("garbage"))).toBe(true);
  });

  it("refuses everything when the stored row cannot be parsed", () => {
    expect(parseStoredAccessPolicy("{not json")).toEqual({ models: [], plugins: [], skills: [] });
    expect(parseStoredAccessPolicy(null)).toEqual({});
  });
});

describe("matchesPattern", () => {
  it("matches exactly, ignoring case, or by trailing glob", () => {
    expect(matchesPattern("CX/gpt-5", "cx/GPT-5")).toBe(true);
    expect(matchesPattern("cx/*", "cx/gpt-5")).toBe(true);
    expect(matchesPattern("cx/*", "cxx/gpt-5")).toBe(false);
    expect(matchesPattern("*", "anything")).toBe(true);
    expect(matchesPattern("dev", "dev2")).toBe(false);
  });
});

describe("layersAllow", () => {
  it("allows only what every layer allows — a key narrows its member, never widens", () => {
    const org = { models: ["cx/*", "dev"] };
    const key = { models: ["cx/gpt-5", "kgw/*"] };
    expect(layersAllow([org, key], "models", ["cx/gpt-5"])).toBe(true);
    expect(layersAllow([org, key], "models", ["kgw/kilo-auto/free"])).toBe(false);
    expect(layersAllow([org, key], "models", ["dev"])).toBe(false);
  });

  it("treats a layer without the field as unrestricted, and no layers as everything", () => {
    expect(layersAllow([{ skills: [] }], "models", ["x/y"])).toBe(true);
    expect(layersAllow([], "plugins", ["memory"])).toBe(true);
  });

  it("accepts the thing when any of its spellings matches", () => {
    expect(layersAllow([{ models: ["codex/*"] }], "models", ["cx/gpt-5", "codex/gpt-5"])).toBe(true);
  });

  it("refuses everything for an empty list", () => {
    expect(layersAllow([{ models: [] }], "models", ["cx/gpt-5"])).toBe(false);
  });
});

describe("filterAllowed", () => {
  it("drops what any layer forbids and leaves the list alone when nothing restricts it", () => {
    expect(filterAllowed([{ skills: ["a", "c"] }, { skills: ["c"] }], "skills", ["a", "b", "c"])).toEqual(["c"]);
    expect(filterAllowed([{ models: [] }], "skills", ["a"])).toEqual(["a"]);
    expect(layersRestrict([{ models: [] }], "skills")).toBe(false);
  });
});

describe("usage limits", () => {
  it("keeps positive rpm and budget, drops anything else", () => {
    expect(normalizeAccessPolicy({ limits: { rpm: 30.7, monthlyBudgetUsd: 25.5, extra: 1 } })).toEqual({
      limits: { rpm: 30, monthlyBudgetUsd: 25.5 },
    });
    expect(normalizeAccessPolicy({ limits: { rpm: 0, monthlyBudgetUsd: -1 } })).toEqual({});
    expect(normalizeAccessPolicy({ limits: "x" })).toEqual({});
  });

  it("counts a limit as a restriction", () => {
    expect(isUnrestricted({ limits: { rpm: 10 } })).toBe(false);
  });

  it("keeps a limit through a stored round trip", () => {
    expect(parseStoredAccessPolicy(JSON.stringify({ models: ["cx/*"], limits: { monthlyBudgetUsd: 5 } }))).toEqual({
      models: ["cx/*"], limits: { monthlyBudgetUsd: 5 },
    });
  });
});
