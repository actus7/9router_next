import { describe, expect, it } from "vitest";
import {
  composePluginRows,
  type BundleRow,
  type FactoryRegistry,
  type PatchRow,
} from "@/server/plugin-core/composition";

const bundle: BundleRow[] = [
  { id: "persona", plugin: "harness-capability", config: { title: "ModelHub context" } },
  { id: "tool-web-search", plugin: "harness-capability", config: { title: "Web search" } },
  { id: "opencode", plugin: "provider-executor", config: { provider: "opencode" } },
];

const registry: FactoryRegistry = {
  has: (plugin) => plugin === "harness-capability" || plugin === "provider-executor",
  validate: (_plugin, config) =>
    typeof config.title === "string" || typeof config.provider === "string"
      ? null
      : "config needs a title or a provider",
};

function patch(overrides: Partial<PatchRow> & Pick<PatchRow, "id" | "plugin">): PatchRow {
  return {
    config: { title: "patched" },
    position: 0,
    enabled: true,
    source: "override",
    ...overrides,
  };
}

describe("composePluginRows", () => {
  it("reproduces the bundle exactly when there is no patch", () => {
    const result = composePluginRows(bundle, [], registry);

    expect(result.diagnostics).toEqual([]);
    expect(result.rows.map((row) => row.id)).toEqual([
      "persona",
      "tool-web-search",
      "opencode",
    ]);
    expect(result.rows.every((row) => row.origin === "bundle")).toBe(true);
    expect(result.rows[0]!.config).toEqual({ title: "ModelHub context" });
  });

  it("replaces a bundle row's whole config when a patch targets its id", () => {
    const result = composePluginRows(
      bundle,
      [patch({ id: "persona", plugin: "harness-capability", config: { title: "Custom" } })],
      registry,
    );

    const persona = result.rows.find((row) => row.id === "persona");
    expect(persona!.config).toEqual({ title: "Custom" });
    expect(persona!.origin).toBe("override");
  });

  it("removes a row the patch disables, without reporting it as a problem", () => {
    const result = composePluginRows(
      bundle,
      [patch({ id: "tool-web-search", plugin: "harness-capability", enabled: false })],
      registry,
    );

    expect(result.rows.map((row) => row.id)).not.toContain("tool-web-search");
    expect(result.diagnostics).toEqual([]);
  });

  it("inserts a row whose id is not in the bundle", () => {
    const result = composePluginRows(
      bundle,
      [
        patch({
          id: "tool-custom",
          plugin: "harness-capability",
          source: "user",
          config: { title: "Custom tool" },
          position: 99,
        }),
      ],
      registry,
    );

    const inserted = result.rows.find((row) => row.id === "tool-custom");
    expect(inserted).toBeDefined();
    expect(inserted!.origin).toBe("user");
    expect(result.rows.at(-1)!.id).toBe("tool-custom");
  });

  it("orders by position and breaks ties by id so composition is deterministic", () => {
    const result = composePluginRows(
      bundle,
      [
        patch({ id: "opencode", plugin: "provider-executor", config: { provider: "opencode" }, position: -1 }),
        patch({ id: "aaa", plugin: "harness-capability", source: "user", position: -1 }),
      ],
      registry,
    );

    expect(result.rows.slice(0, 2).map((row) => row.id)).toEqual(["aaa", "opencode"]);
  });

  // The safety property the whole design rests on: a bad row degrades to the
  // bundle default, it never removes a plugin and never throws.
  it("keeps the bundle row when its override names an unknown factory", () => {
    const result = composePluginRows(
      bundle,
      [patch({ id: "persona", plugin: "does-not-exist" })],
      registry,
    );

    const persona = result.rows.find((row) => row.id === "persona");
    expect(persona!.config).toEqual({ title: "ModelHub context" });
    expect(persona!.origin).toBe("bundle");
    expect(result.diagnostics).toEqual([
      { rowId: "persona", reason: "unknown plugin factory: does-not-exist" },
    ]);
  });

  it("keeps the bundle row when its override carries an invalid config", () => {
    const result = composePluginRows(
      bundle,
      [patch({ id: "persona", plugin: "harness-capability", config: { nope: 1 } })],
      registry,
    );

    const persona = result.rows.find((row) => row.id === "persona");
    expect(persona!.config).toEqual({ title: "ModelHub context" });
    expect(result.diagnostics).toEqual([
      { rowId: "persona", reason: "config needs a title or a provider" },
    ]);
  });

  it("drops an inserted row with an unknown factory and reports it", () => {
    const result = composePluginRows(
      bundle,
      [patch({ id: "ghost", plugin: "does-not-exist", source: "user" })],
      registry,
    );

    expect(result.rows.map((row) => row.id)).not.toContain("ghost");
    expect(result.diagnostics).toEqual([
      { rowId: "ghost", reason: "unknown plugin factory: does-not-exist" },
    ]);
  });

  it("drops a stale override that points at a bundle row which no longer exists", () => {
    const result = composePluginRows(
      bundle,
      [patch({ id: "removed-long-ago", plugin: "harness-capability" })],
      registry,
    );

    expect(result.rows.map((row) => row.id)).not.toContain("removed-long-ago");
    expect(result.diagnostics).toEqual([
      { rowId: "removed-long-ago", reason: "override targets no bundle row" },
    ]);
  });

  it("never throws on malformed input", () => {
    const malformed = [
      { id: "", plugin: "", config: {}, position: 0, enabled: true, source: "user" },
      { id: "x", plugin: "harness-capability", config: null, position: 0, enabled: true, source: "user" },
    ] as unknown as PatchRow[];

    expect(() => composePluginRows(bundle, malformed, registry)).not.toThrow();
    const result = composePluginRows(bundle, malformed, registry);
    expect(result.rows.map((row) => row.id)).toEqual(["persona", "tool-web-search", "opencode"]);
    expect(result.diagnostics).toHaveLength(2);
  });
});
