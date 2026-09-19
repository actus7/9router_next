import { describe, expect, it } from "vitest";

import {
  normalizeConfiguredModel,
  normalizeLiveModel,
  normalizeStaticModel,
} from "@/app/(dashboard)/dashboard/basic-chat/chatModelUtils";

const kilo = { provider: "kilo-gateway", name: "actus", id: "conn-1" };

/**
 * The chat addresses a model as `<provider>/<model>`, and the gateway reads the
 * provider from the first segment. Both normalisers used to skip the prefix
 * whenever the raw id already contained a slash — which reads as "already
 * qualified" but is wrong for every vendor-scoped id.
 *
 * Kilo Gateway serves `openrouter/free` and `inclusionai/ling-3.0-flash-fin:free`.
 * Sent unprefixed, the gateway resolved `openrouter` and `inclusionai` as the
 * providers and answered "No active credentials for provider: openrouter" for a
 * connection that was active and had just passed its test.
 */
describe("qualifying a model id for the chat", () => {
  it("prefixes a vendor-scoped id with the provider that serves it", () => {
    expect(normalizeLiveModel({ id: "inclusionai/ling-3.0-flash-fin:free" }, kilo)?.requestModel)
      .toBe("kilo-gateway/inclusionai/ling-3.0-flash-fin:free");
    expect(normalizeConfiguredModel("openrouter/free", kilo)?.requestModel)
      .toBe("kilo-gateway/openrouter/free");
  });

  it("does not prefix twice when the id already names its provider", () => {
    expect(normalizeLiveModel({ id: "kilo-gateway/kilo-auto/free" }, kilo)?.requestModel)
      .toBe("kilo-gateway/kilo-auto/free");
    expect(normalizeConfiguredModel("kilo-gateway/kilo-auto/free", kilo)?.requestModel)
      .toBe("kilo-gateway/kilo-auto/free");
  });

  it("accepts the provider's short alias as a prefix too", () => {
    // The provider screen copies model ids as `kgw/...`, and a connection can
    // carry its own prefix; neither is a vendor segment.
    expect(normalizeConfiguredModel("kgw/openrouter/free", kilo)?.requestModel)
      .toBe("kilo-gateway/openrouter/free");
    expect(normalizeLiveModel({ id: "custom/gpt-5" }, { ...kilo, providerSpecificData: { prefix: "custom" } })?.requestModel)
      .toBe("kilo-gateway/gpt-5");
  });

  it("still qualifies a plain id", () => {
    expect(normalizeLiveModel({ id: "gpt-5" }, { provider: "openai" })?.requestModel).toBe("openai/gpt-5");
    expect(normalizeStaticModel({ id: "gpt-5" }, { provider: "openai" })?.requestModel).toBe("openai/gpt-5");
  });
});
