import { describe, expect, it } from "vitest";
import { getModelKind } from "@/shared/constants/models";

describe("model kind inference", () => {
  it("keeps chat models untyped while identifying unmistakable media models", () => {
    expect(getModelKind({ id: "llama-3.3-70b-instruct:free" })).toBeNull();
    expect(getModelKind({ id: "eleven-multilingual-v2:free" })).toBe("tts");
    expect(getModelKind({ id: "whisper-large-v3:free" })).toBe("stt");
    expect(getModelKind({ id: "flux-1-schnell:free" })).toBe("image");
    expect(getModelKind({ id: "text-embedding-3-small" })).toBe("embedding");
  });

  it("always preserves explicit provider metadata", () => {
    expect(getModelKind({ id: "flux-1-schnell", kind: "llm" })).toBe("llm");
  });
});
