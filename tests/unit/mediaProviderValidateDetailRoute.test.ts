import { describe, expect, it } from "vitest";
import {
  isCustomEmbeddingDetail,
  isValidBuiltInMediaProviderDetail,
  isValidMediaProviderKind,
} from "@/app/(dashboard)/dashboard/media-providers/validateDetailRoute";

describe("validateDetailRoute", () => {
  it("accepts known media provider kinds", () => {
    expect(isValidMediaProviderKind("tts")).toBe(true);
    expect(isValidMediaProviderKind("embedding")).toBe(true);
    expect(isValidMediaProviderKind("not-a-kind")).toBe(false);
  });

  it("identifies custom embedding detail routes", () => {
    expect(isCustomEmbeddingDetail("embedding", "custom-embedding-foo")).toBe(true);
    expect(isCustomEmbeddingDetail("tts", "custom-embedding-foo")).toBe(false);
  });

  it("validates built-in provider and kind pairs", () => {
    expect(isValidBuiltInMediaProviderDetail("tts", "openai")).toBe(true);
    expect(isValidBuiltInMediaProviderDetail("tts", "not-a-provider")).toBe(false);
  });
});
