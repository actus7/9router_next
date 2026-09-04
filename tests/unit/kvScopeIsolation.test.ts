import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Four product concepts share the `kv` table — model aliases, custom models,
 * pricing overrides and disabled models — separated only by the `scope` column,
 * behind a single shared index.
 *
 * That is a deliberate trade: splitting it into four tables costs a rebuild
 * migration and four rewritten repos to buy a guarantee this test gives for far
 * less. But nothing in the database stops a scope bug in one repo from writing
 * inside another's namespace, so the guarantee has to be asserted somewhere.
 *
 * Repos write the scope two ways — bound as a parameter (the shared `makeKv`
 * helper) or inlined as a SQL literal (pricingRepo's own statements). The fake
 * honours both; a fake that ignored scope would pass this test for the wrong
 * reason.
 */
const store = vi.hoisted(() => new Map<string, string>());

const adapter = vi.hoisted(() => {
  // Two inline forms exist: `WHERE scope = 'pricing'` in reads, and
  // `VALUES('pricing', ?, ?)` in the insert. Missing the second one is how a
  // fake ends up filing a row under the wrong scope and failing for its own
  // reasons rather than the code's.
  const inlineScope = (sql: string): string | null => {
    const where = /scope = '([^']+)'/.exec(sql);
    if (where) return where[1];
    const values = /VALUES\('([^']+)'/.exec(sql);
    return values ? values[1] : null;
  };
  const rowKey = (scope: string, k: string) => `${scope} ${k}`;

  return {
    all: (sql: string, params: unknown[] = []) => {
      const scope = inlineScope(sql) ?? String(params[0] ?? "");
      const prefix = `${scope} `;
      return [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, value]) => ({ key: k.slice(prefix.length), value }));
    },
    get: (sql: string, params: unknown[] = []) => {
      const inline = inlineScope(sql);
      const scope = inline ?? String(params[0] ?? "");
      const k = String(inline ? params[0] : params[1]);
      const value = store.get(rowKey(scope, k));
      return value === undefined ? undefined : { key: k, value };
    },
    run: (sql: string, params: unknown[] = []) => {
      const inline = inlineScope(sql);
      if (/^\s*DELETE/i.test(sql)) {
        const scope = inline ?? String(params[0] ?? "");
        const expectsKey = inline ? params.length >= 1 : params.length >= 2;
        if (!expectsKey) {
          for (const k of [...store.keys()]) {
            if (k.startsWith(`${scope} `)) store.delete(k);
          }
          return { changes: 1 };
        }
        store.delete(rowKey(scope, String(inline ? params[0] : params[1])));
        return { changes: 1 };
      }
      if (/^\s*INSERT/i.test(sql)) {
        // VALUES(?, ?, ?) → [scope, key, value]
        // VALUES('pricing', ?, ?) → [key, value]
        const [scope, k, value] = inline
          ? [inline, String(params[0]), String(params[1])]
          : [String(params[0]), String(params[1]), String(params[2])];
        store.set(rowKey(scope, k), value);
        return { changes: 1 };
      }
      // UPDATE kv SET value = ? WHERE scope = ... AND key = ?
      const scope = inline ?? String(params[1] ?? "");
      const k = String(inline ? params[1] : params[2]);
      store.set(rowKey(scope, k), String(params[0]));
      return { changes: 1 };
    },
    transaction: (fn: () => void) => fn(),
  };
});

vi.mock("@/lib/db/driver", () => ({ getAdapter: vi.fn(async () => adapter) }));

import { getModelAliases, setModelAlias } from "@/lib/db/repos/aliasRepo";
import { getDisabledModels, disableModels } from "@/lib/db/repos/disabledModelsRepo";
// getPricingOverrides, not getPricing: the latter merges the built-in
// PROVIDER_PRICING table in, so it is not a reader of this scope alone.
import { getPricingOverrides, updatePricing } from "@/lib/db/repos/pricingRepo";

beforeEach(() => {
  store.clear();
});

describe("kv scope isolation", () => {
  it("keeps each concept inside its own scope", async () => {
    await setModelAlias("fast", "openai/gpt-4o-mini");
    await disableModels("openai", ["gpt-3.5-turbo"]);
    await updatePricing({ openai: { "gpt-4o": { input: 1, output: 2 } } });

    const scopes = new Set([...store.keys()].map((k) => k.split(" ")[0]));
    expect([...scopes].sort()).toEqual(["disabledModels", "modelAliases", "pricing"]);
  });

  it("does not let one repo read another's rows", async () => {
    await setModelAlias("fast", "openai/gpt-4o-mini");
    await disableModels("openai", ["gpt-3.5-turbo"]);
    await updatePricing({ openai: { "gpt-4o": { input: 1, output: 2 } } });

    // Each repo sees only its own keys, even though all three rows live in one
    // table and "openai" is a key in two different scopes.
    expect(Object.keys(await getModelAliases())).toEqual(["fast"]);
    expect(Object.keys(await getDisabledModels())).toEqual(["openai"]);
    expect(Object.keys(await getPricingOverrides())).toEqual(["openai"]);

    expect(await getModelAliases()).not.toHaveProperty("openai");
    expect((await getDisabledModels()).openai).toEqual(["gpt-3.5-turbo"]);
  });

  it("survives the same key existing in two scopes", async () => {
    // "openai" as an alias name AND as a provider key for disabled models.
    await setModelAlias("openai", "openai/gpt-4o");
    await disableModels("openai", ["gpt-4-vision"]);

    expect((await getModelAliases()).openai).toBe("openai/gpt-4o");
    expect((await getDisabledModels()).openai).toEqual(["gpt-4-vision"]);
  });
});
