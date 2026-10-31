import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "@/server/llm-gateway/engine/providers/capabilities";
import { getThinkingLevels } from "@/server/llm-gateway/engine/providers/thinkingLevels";

// Copilot / Kiro list Opus 5.5 with dotted ids ("claude-opus-5.5"). They fell to the generic
// *claude*opus-5* row, which lets thinking be turned off; Opus 5.5 answers that with 400
// ("thinking.type.disabled" is not supported for this model).

describe("Claude Opus 5.5 dotted ids cannot disable thinking", () => {
  it.each(["github", "kiro"])("%s/claude-opus-5.5 is adaptive and cannot disable thinking", (provider) => {
    expect(getCapabilitiesForModel(provider, "claude-opus-5.5")).toMatchObject({
      thinkingFormat: "claude-adaptive",
      thinkingCanDisable: false,
    });
  });

  it("level picker has no 'none' for claude-opus-5.5", () => {
    expect(getThinkingLevels("github", "claude-opus-5.5")).not.toContain("none");
  });

  it("claude-opus-5 keeps the ability to disable thinking", () => {
    expect(getCapabilitiesForModel("github", "claude-opus-5").thinkingCanDisable).not.toBe(false);
  });
});
