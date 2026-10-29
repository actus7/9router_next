import { describe, expect, it } from "vitest";
import {
  normalizeSmartRoutingConfig,
  routableProfiles,
} from "@/server/llm-gateway/engine/services/smart-routing/router";
import type { SmartModelProfile } from "@/server/llm-gateway/engine/services/smart-routing/types";
import { FREE_DEFAULT_MODEL_KEY } from "@/shared/constants/freeDefault";

const profile = (modelKey: string) => ({ modelKey }) as SmartModelProfile;
const keys = (profiles: SmartModelProfile[]) => profiles.map((p) => p.modelKey);
const inventory = ["a/one", "b/two", "c/three", "d/vision", FREE_DEFAULT_MODEL_KEY].map(profile);

describe("normalizeSmartRoutingConfig model scope", () => {
  it("keeps an old config's exact shape: no scope, no free switch", () => {
    const config = normalizeSmartRoutingConfig({});
    expect(config).not.toHaveProperty("modelScope");
    expect(config).not.toHaveProperty("freeFallback");
  });

  it("keeps a selected scope and a free fallback turned off", () => {
    const config = normalizeSmartRoutingConfig({ modelScope: "selected", freeFallback: false });
    expect(config.modelScope).toBe("selected");
    expect(config.freeFallback).toBe(false);
  });

  it("drops an unknown scope instead of guessing", () => {
    expect(normalizeSmartRoutingConfig({ modelScope: "some" })).not.toHaveProperty("modelScope");
  });
});

describe("routableProfiles", () => {
  it("routes to the whole inventory when the combo uses every model", () => {
    const config = normalizeSmartRoutingConfig({});
    expect(keys(routableProfiles(inventory, config, ["a/one"]))).toEqual(keys(inventory));
  });

  it("routes only to the chosen models when the combo is restricted", () => {
    const config = normalizeSmartRoutingConfig({ modelScope: "selected" });
    expect(keys(routableProfiles(inventory, config, ["a/one", "c/three"]))).toEqual(["a/one", "c/three"]);
  });

  it("also allows what is pinned per request type, so an image or vision request has somewhere to go", () => {
    const config = normalizeSmartRoutingConfig({
      modelScope: "selected",
      overrides: { vision: { default: ["d/vision"] }, general: { complex: ["b/two"] } },
    });
    expect(keys(routableProfiles(inventory, config, ["a/one"]))).toEqual(["a/one", "b/two", "d/vision"]);
  });

  it("answers nothing rather than the inventory when the chosen models are gone", () => {
    const config = normalizeSmartRoutingConfig({ modelScope: "selected" });
    expect(routableProfiles(inventory, config, ["z/removed"])).toEqual([]);
  });

  it("leaves the free default out when the combo turned it off, unless it was picked by hand", () => {
    const off = normalizeSmartRoutingConfig({ freeFallback: false });
    expect(keys(routableProfiles(inventory, off, []))).not.toContain(FREE_DEFAULT_MODEL_KEY);
    expect(keys(routableProfiles(inventory, off, [FREE_DEFAULT_MODEL_KEY]))).toContain(FREE_DEFAULT_MODEL_KEY);
  });
});
