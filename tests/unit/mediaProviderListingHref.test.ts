import { describe, expect, it } from "vitest";
import {
  isCombinedWebKind,
  mediaProviderListingHref,
} from "@/app/(dashboard)/dashboard/media-providers/listingHref";

describe("mediaProviderListingHref", () => {
  it("sends both web kinds to the combined listing", () => {
    expect(mediaProviderListingHref("webSearch")).toBe("/dashboard/media-providers/web");
    expect(mediaProviderListingHref("webFetch")).toBe("/dashboard/media-providers/web");
  });

  it("leaves every other kind on its own listing", () => {
    expect(mediaProviderListingHref("stt")).toBe("/dashboard/media-providers/stt");
    expect(mediaProviderListingHref("image")).toBe("/dashboard/media-providers/image");
  });

  it("identifies the kinds whose own route is only a redirect stub", () => {
    expect(isCombinedWebKind("webSearch")).toBe(true);
    expect(isCombinedWebKind("tts")).toBe(false);
  });
});
