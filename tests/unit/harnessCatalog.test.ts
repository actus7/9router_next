import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_PRESETS,
  BUNDLE_CATALOG,
  HARNESS_PLUGINS,
  buildHarnessCatalog,
  getRuntimeToolDefinitions,
  resetActiveHarnessCatalog,
  resolveSessionPlugins,
  setActiveHarnessCatalog,
  type HarnessPluginDefinition,
} from "@/shared/harness/agentPlugins";

afterEach(() => resetActiveHarnessCatalog());

const extraPlugin: HarnessPluginDefinition = {
  id: "tool-minesweeper",
  title: "Minesweeper",
  description: "Generates a board.",
  module: "db:tool-minesweeper",
  kind: "tool",
  tool: {
    type: "function",
    function: { name: "minesweeper_board", description: "Generates a board.", parameters: {} },
  },
};

describe("the active harness catalogue", () => {
  // The migration-safety property the whole design rests on: with nothing
  // composed, every resolution function must behave exactly as it does today.
  it("defaults to the bundle catalogue", () => {
    expect(BUNDLE_CATALOG.plugins).toEqual(HARNESS_PLUGINS);
    expect(resolveSessionPlugins("standard").map((p) => p.id)).toEqual(
      HARNESS_PLUGINS.map((p) => p.id),
    );
  });

  it("resolves against a composed catalogue once one is set", () => {
    setActiveHarnessCatalog(buildHarnessCatalog([...HARNESS_PLUGINS, extraPlugin]));

    const ids = resolveSessionPlugins("standard").map((p) => p.id);
    expect(ids).toContain("tool-minesweeper");
  });

  it("exposes a composed plugin's tool to the model", () => {
    setActiveHarnessCatalog(buildHarnessCatalog([...HARNESS_PLUGINS, extraPlugin]));

    const names = getRuntimeToolDefinitions("standard").map((t) => t.function.name);
    expect(names).toContain("minesweeper_board");
  });

  it("drops a plugin the composition removed", () => {
    const withoutWebSearch = HARNESS_PLUGINS.filter((p) => p.id !== "tool-web-search");
    setActiveHarnessCatalog(buildHarnessCatalog(withoutWebSearch));

    expect(resolveSessionPlugins("standard").map((p) => p.id)).not.toContain("tool-web-search");
  });

  it("restores the bundle catalogue on reset", () => {
    setActiveHarnessCatalog(buildHarnessCatalog([extraPlugin]));
    resetActiveHarnessCatalog();

    expect(resolveSessionPlugins("standard").map((p) => p.id)).toEqual(
      HARNESS_PLUGINS.map((p) => p.id),
    );
  });
});

describe("buildHarnessCatalog", () => {
  it("keeps the standard preset meaning every plugin in the catalogue", () => {
    const catalog = buildHarnessCatalog([...HARNESS_PLUGINS, extraPlugin]);
    const standard = catalog.presets.find((preset) => preset.id === "standard");

    expect(standard!.pluginIds).toContain("tool-minesweeper");
  });

  it("narrows a curated preset to the plugins that actually exist", () => {
    const catalog = buildHarnessCatalog(
      HARNESS_PLUGINS.filter((plugin) => plugin.id !== "tool-web-search"),
    );
    const research = catalog.presets.find((preset) => preset.id === "research");
    const bundled = AGENT_PRESETS.find((preset) => preset.id === "research");

    expect(bundled!.pluginIds).toContain("tool-web-search");
    expect(research!.pluginIds).not.toContain("tool-web-search");
  });
});
