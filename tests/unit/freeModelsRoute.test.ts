import { describe, expect, it } from "vitest";
import { parseRemoteModels } from "@/app/api/models/free/route";
import { isFreeModelEnabledForChat } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useChatModels";

describe("free model discovery", () => {
  it("keeps every chat-capable model returned by a no-auth provider", () => {
    expect(parseRemoteModels({
      data: [
        { id: "big-pickle" },
        { id: "mimo-v2.5-free", name: "MiMo" },
        { id: "ling-3.0-flash-fin-free" },
        { id: "audio-transcribe" },
      ],
    })).toEqual([
      { id: "big-pickle", name: "big-pickle" },
      { id: "mimo-v2.5-free", name: "MiMo" },
      { id: "ling-3.0-flash-fin-free", name: "ling-3.0-flash-fin-free" },
    ]);
  });

  it("keeps active free models while respecting models disabled in the provider screen", () => {
    const disabled = { oc: ["deepseek-v4-flash-free", "muse-spark-1.2-contributor-free", "nemotron-3-ultra-free"] };
    expect(isFreeModelEnabledForChat("opencode", "oc/mimo-v2.5-free", disabled)).toBe(true);
    expect(isFreeModelEnabledForChat("opencode", "oc/deepseek-v4-flash-free", disabled)).toBe(false);
  });
});
