import { describe, expect, it } from "vitest";

import {
  FREE_DEFAULT_MODEL,
  FREE_DEFAULT_MODEL_KEY,
  FREE_DEFAULT_PROVIDER_ALIAS,
  FREE_DEFAULT_PROVIDER_ID,
  isFreeDefaultProvider,
} from "@/shared/constants/freeDefault";
import opencodeEntry from "@/server/llm-gateway/engine/providers/registry/opencode";
import { __test__ as routerInternals } from "@/server/llm-gateway/engine/services/smart-routing/router";
import type { SmartModelProfile, SmartRoutingConfig } from "@/server/llm-gateway/engine/services/smart-routing/types";
import { DEFAULT_SMART_ROUTING_CONFIG } from "@/server/llm-gateway/engine/services/smart-routing/types";

/**
 * The constant is only useful while it still names something the registry
 * serves. A rename upstream has to fail here, not in production on a fresh
 * install where this is the only model that answers.
 */
describe("credential-free default", () => {
  it("names the provider the registry declares as no-auth", () => {
    expect(opencodeEntry.id).toBe(FREE_DEFAULT_PROVIDER_ID);
    expect(opencodeEntry.alias).toBe(FREE_DEFAULT_PROVIDER_ALIAS);
    expect(opencodeEntry.noAuth).toBe(true);
  });

  it("names a model the provider actually carries", () => {
    expect(opencodeEntry.models.map((model) => model.id)).toContain(FREE_DEFAULT_MODEL);
  });

  it("builds the alias-qualified key used by chat, routing and the gateway", () => {
    expect(FREE_DEFAULT_MODEL_KEY).toBe(`${opencodeEntry.alias}/${FREE_DEFAULT_MODEL}`);
  });

  it("recognizes both spellings callers see", () => {
    expect(isFreeDefaultProvider(FREE_DEFAULT_PROVIDER_ID)).toBe(true);
    expect(isFreeDefaultProvider(FREE_DEFAULT_PROVIDER_ALIAS)).toBe(true);
    expect(isFreeDefaultProvider("openai")).toBe(false);
  });
});

function profile(modelKey: string, quality: number): SmartModelProfile {
  const [provider, model] = modelKey.split("/");
  return {
    modelKey,
    provider: provider!,
    model: model!,
    displayName: modelKey,
    capabilities: {
      serviceKinds: ["llm"],
      vision: false, pdf: false, audioInput: false, videoInput: false,
      imageOutput: false, audioOutput: false, tools: false, search: false,
      reasoning: false, contextWindow: 8000, maxOutput: 1000,
    },
    inputPrice: null,
    outputPrice: null,
    quality,
    latencyScore: 0.5,
    reliabilityScore: 0.5,
    recommendedTier: "standard",
    needScores: {},
    source: "deterministic",
    inventoryFingerprint: "test",
  };
}

function configWithClassifier(model: string): SmartRoutingConfig {
  return {
    ...DEFAULT_SMART_ROUTING_CONFIG,
    classifier: { ...DEFAULT_SMART_ROUTING_CONFIG.classifier, model },
  };
}

describe("routing classifier model choice", () => {
  const auto = configWithClassifier("auto");

  it("prefers the free default over a stronger paid model", () => {
    const chosen = routerInternals.chooseClassifierModel(auto, [
      profile("openai/gpt-5", 0.99),
      profile(FREE_DEFAULT_MODEL_KEY, 0.4),
    ]);

    // Classifying only picks a tier from a fixed list; spending the strongest
    // model on that is waste, and the free one needs no account.
    expect(chosen).toBe(FREE_DEFAULT_MODEL_KEY);
  });

  it("falls back to the best available model when the free default is absent", () => {
    const chosen = routerInternals.chooseClassifierModel(auto, [
      profile("openai/gpt-4o-mini", 0.5),
      profile("openai/gpt-5", 0.99),
    ]);

    expect(chosen).toBe("openai/gpt-5");
  });

  it("keeps an explicitly configured classifier model", () => {
    const chosen = routerInternals.chooseClassifierModel(configWithClassifier("openai/gpt-5"), [
      profile("openai/gpt-5", 0.99),
      profile(FREE_DEFAULT_MODEL_KEY, 0.4),
    ]);

    expect(chosen).toBe("openai/gpt-5");
  });

  it("returns null when nothing can classify", () => {
    expect(routerInternals.chooseClassifierModel(auto, [])).toBeNull();
  });
});
