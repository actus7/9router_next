import { describe, expect, it } from "vitest";
import { isChatKindModel } from "@/app/(dashboard)/dashboard/basic-chat/chatModelUtils";
import type { NormalizedModel } from "@/app/(dashboard)/dashboard/basic-chat/types";

function model(id: string, extra: Partial<NormalizedModel> = {}): NormalizedModel {
  return {
    id,
    requestModel: id,
    name: id,
    providerId: "xiaomi-tokenplan",
    providerName: "schmitt",
    source: "live",
    ...extra,
  } as NormalizedModel;
}

// The chat picker listed every model a provider's catalogue/discovery returned,
// including speech models: xiaomi-tokenplan surfaced mimo-v2.5-tts,
// -tts-voiceclone, -tts-voicedesign and -asr as selectable chat models.
describe("chat model kind filter", () => {
  it("keeps chat models", () => {
    expect(isChatKindModel(model("xiaomi-tokenplan/mimo-v2.5"))).toBe(true);
    expect(isChatKindModel(model("xiaomi-tokenplan/mimo-v2.5-pro"))).toBe(true);
    expect(isChatKindModel(model("groq/llama-3.3-70b-versatile"))).toBe(true);
  });

  it("drops speech, image and embedding models", () => {
    expect(isChatKindModel(model("xiaomi-tokenplan/mimo-v2.5-tts"))).toBe(false);
    expect(isChatKindModel(model("xiaomi-tokenplan/mimo-v2.5-tts-voiceclone"))).toBe(false);
    expect(isChatKindModel(model("xiaomi-tokenplan/mimo-v2.5-tts-voicedesign"))).toBe(false);
    expect(isChatKindModel(model("xiaomi-tokenplan/mimo-v2.5-asr"))).toBe(false);
    expect(isChatKindModel(model("groq/whisper-large-v3-turbo"))).toBe(false);
    expect(isChatKindModel(model("openai/text-embedding-3-small"))).toBe(false);
  });

  it("trusts explicit provider metadata over the id heuristic", () => {
    expect(isChatKindModel(model("weird/tts-named-chat-model", { kind: "llm" }))).toBe(true);
    expect(isChatKindModel(model("weird/plain-name", { kind: "tts" }))).toBe(false);
  });
});
