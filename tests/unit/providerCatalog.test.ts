import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AI_PROVIDERS,
  getProviderAvailability,
  getProviderConnectionAuthTypes,
  resolveProviderId,
  validateProviderCatalog,
  type ProviderCatalogEntry,
} from "@/shared/constants/providers";
import REGISTRY from "@/server/llm-gateway/engine/providers/registry/index";
import { REGISTRY_TOP_LEVEL_KEYS } from "@/server/llm-gateway/engine/providers/schema";
import { describe, expect, it } from "vitest";

const registryDir = resolve(__dirname, "../../src/server/llm-gateway/engine/providers/registry");

describe("provider registry index", () => {
  // registry/index.ts is hand-maintained despite claiming to be generated, so
  // a new entry file can silently never reach PROVIDERS. Providers parked with
  // a commented-out import (trae, windsurf, devin-cli) count as accounted for;
  // a file nobody mentions at all does not.
  it("accounts for every registry entry file", () => {
    const entryFiles = readdirSync(registryDir)
      .filter((name) => name.endsWith(".ts") && name !== "index.ts")
      .map((name) => name.replace(/\.ts$/, ""))
      .sort();

    const lines = readFileSync(join(registryDir, "index.ts"), "utf8").split(/\r?\n/);
    const importOf = (line: string): string | null =>
      line.match(/import\s+p\d+\s+from\s+"\.\/([^"]+)"/)?.[1] ?? null;
    const active = lines.filter((line) => !line.trimStart().startsWith("//")).map(importOf);
    const parked = lines.filter((line) => line.trimStart().startsWith("//")).map(importOf);

    const activeImports = active.filter((name): name is string => name !== null);
    const mentioned = [...activeImports, ...parked.filter((name): name is string => name !== null)];

    expect([...mentioned].sort()).toEqual(entryFiles);
    expect(new Set(mentioned).size).toBe(mentioned.length);
    // Every active import must also be listed in the exported array.
    expect(REGISTRY).toHaveLength(activeImports.length);
  });

  // Nested blocks are deliberately untyped, so a typo like `transprot` used to
  // load fine and do nothing. This is the guard for the top level.
  it("uses only contract fields at the top level of every entry", () => {
    const allowed = new Set(REGISTRY_TOP_LEVEL_KEYS);
    const unknown: string[] = [];

    for (const entry of REGISTRY as Array<Record<string, unknown>>) {
      for (const key of Object.keys(entry)) {
        if (!allowed.has(key)) unknown.push(`${String(entry.id)}.${key}`);
      }
    }

    expect(unknown).toEqual([]);
  });

  it("gives every entry the two required fields", () => {
    for (const entry of REGISTRY as Array<Record<string, unknown>>) {
      expect(typeof entry.id, JSON.stringify(entry).slice(0, 80)).toBe("string");
      expect(typeof entry.category, String(entry.id)).toBe("string");
    }
  });
});

describe("provider catalog projection", () => {
  it("keeps aliases resolvable and validates the shipped registry", () => {
    expect(validateProviderCatalog()).toEqual([]);
    expect(resolveProviderId("naga")).toBe("naga-ac");
    expect(resolveProviderId("openrouter")).toBe("openrouter");
  });

  it("derives availability and connection auth from one typed provider entry", () => {
    const naga = AI_PROVIDERS["naga-ac"] as ProviderCatalogEntry;
    const openRouter = AI_PROVIDERS.openrouter as ProviderCatalogEntry;

    expect(getProviderAvailability(naga)).toBe("freeTier");
    expect(getProviderConnectionAuthTypes(naga)).toEqual(["oauth", "apikey", "api_key"]);
    expect(getProviderAvailability(openRouter)).toBe("freeTier");
    expect(getProviderConnectionAuthTypes(openRouter)).toEqual(["apikey", "api_key"]);
  });

  it("reports invalid categories, aliases and incompatible auth declarations", () => {
    const invalid = [
      { id: "duplicate", alias: "same", category: "free" },
      { id: "duplicate", alias: "same", category: "invalid" },
      { id: "mixed", alias: "mixed", category: "free", noAuth: true, authModes: ["apikey"] },
    ];
    expect(validateProviderCatalog(invalid)).toEqual(expect.arrayContaining([
      "Duplicate provider id: duplicate",
      "Duplicate provider alias: same",
      "Provider duplicate has invalid category",
      "Provider mixed mixes noAuth with credential auth",
    ]));
  });
});
