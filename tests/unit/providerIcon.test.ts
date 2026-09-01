import { describe, expect, it } from "vitest";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";

describe("getProviderIconSrc", () => {
  it("uses the text fallback for providers without a licensed local icon", () => {
    expect(getProviderIconSrc("duckai")).toBeNull();
    expect(getProviderIconSrc("ovh")).toBeNull();
    expect(getProviderIconSrc("quillbot")).toBeNull();
  });

  it("continues resolving canonical provider assets", () => {
    expect(getProviderIconSrc("perplexity-agent")).toBe("/providers/perplexity.png");
  });
});
