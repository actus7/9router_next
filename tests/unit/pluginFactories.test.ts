import { describe, expect, it } from "vitest";
import { composePluginRows } from "@/server/plugin-core/composition";
import { BUNDLE_ROWS, catalogFromRows } from "@/server/plugin-core/bundleRows";
import {
  HARNESS_CAPABILITY,
  PROVIDER_EXECUTOR,
  factoryRegistry,
} from "@/server/plugin-core/factories";
import { BUNDLE_CATALOG, HARNESS_PLUGINS } from "@/shared/harness/agentPlugins";

describe("bundle rows", () => {
  it("declares one row per shipped agent capability plus the executor rows", () => {
    const capabilityRows = BUNDLE_ROWS.filter((row) => row.plugin === HARNESS_CAPABILITY);

    expect(capabilityRows.map((row) => row.id)).toEqual(HARNESS_PLUGINS.map((p) => p.id));
    expect(BUNDLE_ROWS.some((row) => row.plugin === PROVIDER_EXECUTOR)).toBe(true);
  });

  it("every bundle row passes its own factory validation", () => {
    for (const row of BUNDLE_ROWS) {
      expect(factoryRegistry.has(row.plugin)).toBe(true);
      expect(factoryRegistry.validate(row.plugin, row.config)).toBeNull();
    }
  });

  // This is the property the migration safety of the whole feature rests on.
  it("composes back into today's catalogue exactly when the patch layer is empty", () => {
    const { rows, diagnostics } = composePluginRows(BUNDLE_ROWS, [], factoryRegistry);

    expect(diagnostics).toEqual([]);
    expect(catalogFromRows(rows).plugins).toEqual(BUNDLE_CATALOG.plugins);
  });
});

describe("factoryRegistry", () => {
  it("rejects an unknown factory name", () => {
    expect(factoryRegistry.has("nope")).toBe(false);
  });

  it("rejects a capability config missing required fields", () => {
    expect(factoryRegistry.validate(HARNESS_CAPABILITY, { id: "x" })).not.toBeNull();
  });

  it("rejects a capability config with an unknown kind", () => {
    expect(
      factoryRegistry.validate(HARNESS_CAPABILITY, {
        id: "x",
        title: "X",
        description: "d",
        module: "m",
        kind: "wat",
      }),
    ).not.toBeNull();
  });

  it("rejects a tool capability whose tool has no function name", () => {
    expect(
      factoryRegistry.validate(HARNESS_CAPABILITY, {
        id: "x",
        title: "X",
        description: "d",
        module: "m",
        kind: "tool",
        tool: { type: "function", function: { description: "d", parameters: {} } },
      }),
    ).not.toBeNull();
  });

  it("accepts a tool capability naming a tool the runtime implements", () => {
    expect(
      factoryRegistry.validate(HARNESS_CAPABILITY, {
        id: "tool-x",
        title: "X",
        description: "d",
        module: "m",
        kind: "tool",
        tool: {
          type: "function",
          function: { name: "web_search", description: "d", parameters: {} },
        },
      }),
    ).toBeNull();
  });

  // A stored row must not advertise a tool nothing can execute; the model would
  // call it and always get "unsupported runtime tool" back.
  it("rejects a tool capability inventing a name the runtime cannot execute", () => {
    expect(
      factoryRegistry.validate(HARNESS_CAPABILITY, {
        id: "tool-minesweeper",
        title: "Minesweeper",
        description: "d",
        module: "m",
        kind: "tool",
        tool: {
          type: "function",
          function: { name: "minesweeper_board", description: "d", parameters: {} },
        },
      }),
    ).toBe("no runtime implementation for tool: minesweeper_board");
  });

  it("rejects an executor row naming a provider with no mountable executor", () => {
    expect(factoryRegistry.validate(PROVIDER_EXECUTOR, { provider: "not-a-provider" })).not.toBeNull();
  });
});

describe("catalogFromRows", () => {
  it("ignores executor rows when building the agent catalogue", () => {
    const catalog = catalogFromRows([
      { id: "opencode", plugin: PROVIDER_EXECUTOR, config: { provider: "opencode" }, position: 0, origin: "bundle" },
    ]);

    expect(catalog.plugins).toEqual([]);
  });

  it("carries a stored capability into the catalogue", () => {
    const catalog = catalogFromRows([
      {
        id: "tool-minesweeper",
        plugin: HARNESS_CAPABILITY,
        config: {
          id: "tool-minesweeper",
          title: "Minesweeper",
          description: "Generates a board.",
          module: "db:tool-minesweeper",
          kind: "tool",
          tool: { type: "function", function: { name: "minesweeper_board", description: "d", parameters: {} } },
        },
        position: 0,
        origin: "user",
      },
    ]);

    expect(catalog.plugins.map((plugin) => plugin.id)).toEqual(["tool-minesweeper"]);
    expect(catalog.presets.find((preset) => preset.id === "standard")!.pluginIds).toEqual([
      "tool-minesweeper",
    ]);
  });
});
