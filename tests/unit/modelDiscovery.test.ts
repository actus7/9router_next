import { describe, expect, it } from "vitest";
import { toDiscoveredModel } from "@/app/(dashboard)/dashboard/providers/components/useModelDiscovery";

describe("toDiscoveredModel", () => {
  it("reads an OpenAI-shaped row", () => {
    expect(toDiscoveredModel({ id: "whisper-large-v3", name: "Whisper Large v3" })).toEqual({
      id: "whisper-large-v3",
      name: "Whisper Large v3",
    });
  });

  it("falls back to the name when a provider omits the id", () => {
    expect(toDiscoveredModel({ name: "tts-1-hd" })).toEqual({ id: "tts-1-hd", name: "tts-1-hd" });
  });

  it("accepts a bare string row", () => {
    expect(toDiscoveredModel("gemma-2")).toEqual({ id: "gemma-2" });
  });

  it("drops rows with nothing usable", () => {
    expect(toDiscoveredModel({ description: "no id here" })).toBeNull();
    expect(toDiscoveredModel("")).toBeNull();
    expect(toDiscoveredModel(null)).toBeNull();
  });
});
