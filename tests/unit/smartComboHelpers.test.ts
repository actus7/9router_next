import { describe, expect, it } from "vitest";
import { foldGeneralDefaultIntoGlobals, normalizeConfig } from "@/app/(dashboard)/dashboard/combos/[id]/smartComboHelpers";

describe("folding the legacy general/default bucket", () => {
  it("moves stranded models into the global list and clears the bucket", () => {
    const config = normalizeConfig({ overrides: { general: { default: ["p/stranded"], complex: ["p/tier"] } } });

    const result = foldGeneralDefaultIntoGlobals(config, ["p/global"]);

    expect(result.models).toEqual(["p/global", "p/stranded"]);
    expect(result.config.overrides.general?.default).toBeUndefined();
    expect(result.config.overrides.general?.complex).toEqual(["p/tier"]);
  });

  it("does not duplicate a model already in the global list", () => {
    const config = normalizeConfig({ overrides: { general: { default: ["p/same"] } } });

    expect(foldGeneralDefaultIntoGlobals(config, ["p/same"]).models).toEqual(["p/same"]);
  });

  it("returns the same config object when there is nothing stranded", () => {
    const config = normalizeConfig({ overrides: { vision: { default: ["p/vision"] } } });

    const result = foldGeneralDefaultIntoGlobals(config, ["p/global"]);

    expect(result.config).toBe(config);
    expect(result.models).toEqual(["p/global"]);
  });
});
