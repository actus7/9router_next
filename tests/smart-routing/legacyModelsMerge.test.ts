import { describe, expect, it } from "vitest";
import { __test__ as routerInternals } from "@/server/llm-gateway/engine/services/smart-routing/router";
import { DEFAULT_SMART_ROUTING_CONFIG, type SmartRoutingConfig } from "@/server/llm-gateway/engine/services/smart-routing/types";

const { mergeLegacyModels } = routerInternals;

function config(overrides: SmartRoutingConfig["overrides"] = {}): SmartRoutingConfig {
  return { ...DEFAULT_SMART_ROUTING_CONFIG, overrides };
}

// `combo.models` e o campo que a UI edita como "sempre considerado". O router o
// dobra em overrides[need].default para DOIS needs (o classificado e o do
// endpoint), o que o torna estritamente mais amplo que editar
// overrides.general.default a mao. A UI unificada depende disso: se este
// contrato mudar, a lista global deixa de valer no need classificado.
describe("combo.models legacy merge", () => {
  it("prepends the list into the need's default bucket, ahead of what was there", () => {
    const merged = mergeLegacyModels(
      config({ coding: { default: ["p/existing"] } }),
      "coding",
      ["p/pinned"],
    );

    expect(merged.overrides.coding?.default).toEqual(["p/pinned", "p/existing"]);
  });

  it("covers the classified need and the endpoint need when applied twice, as the router does", () => {
    const models = ["p/pinned"];
    let merged = mergeLegacyModels(config(), "coding", models);
    merged = mergeLegacyModels(merged, "general", models);

    expect(merged.overrides.coding?.default).toEqual(models);
    expect(merged.overrides.general?.default).toEqual(models);
  });

  it("does not duplicate a model already pinned in that bucket", () => {
    const merged = mergeLegacyModels(config({ general: { default: ["p/pinned"] } }), "general", ["p/pinned"]);
    expect(merged.overrides.general?.default).toEqual(["p/pinned"]);
  });

  it("returns the config untouched when the list is empty", () => {
    const original = config({ general: { default: ["p/existing"] } });
    expect(mergeLegacyModels(original, "general", [])).toBe(original);
  });

  it("leaves the tier buckets alone — they keep precedence over the global list", () => {
    const merged = mergeLegacyModels(
      config({ general: { complex: ["p/tier"] } }),
      "general",
      ["p/pinned"],
    );

    expect(merged.overrides.general?.complex).toEqual(["p/tier"]);
    expect(merged.overrides.general?.default).toEqual(["p/pinned"]);
  });
});
