import { describe, expect, it } from "vitest";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";

describe("getProviderIconSrc", () => {
  it("uses the text fallback for providers without a licensed local icon", () => {
    expect(getProviderIconSrc("duckai")).toBeNull();
    expect(getProviderIconSrc("ovh")).toBeNull();
    expect(getProviderIconSrc("quillbot")).toBeNull();
  });

  it("continues resolving canonical provider assets", () => {
    expect(getProviderIconSrc("perplexity-agent")).toBe("/providers/perplexity-agent.png");
  });

  it("never points at an asset that is not shipped", () => {
    expect(getProviderIconSrc("zenmux-free")).toBeNull();
  });

  it("borrows the parent brand asset for product variants", () => {
    expect(getProviderIconSrc("v0-vercel-web")).toBe("/providers/vercel.png");
    expect(getProviderIconSrc("venice-web")).toBe("/providers/venice.png");
  });

  it("prefers the png when a provider ships more than one asset", () => {
    expect(getProviderIconSrc("kimchi")).toBe("/providers/kimchi.png");
  });
});
