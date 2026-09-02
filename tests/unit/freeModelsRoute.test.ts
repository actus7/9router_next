import { describe, expect, it } from "vitest";
import { parseRemoteModels } from "@/app/api/models/free/route";

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
});
