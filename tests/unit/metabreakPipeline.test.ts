import { describe, expect, it, vi } from "vitest";
import { runTokenSavers } from "@/server/llm-gateway/engine/handlers/chatCore/phases";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";

function parameters() {
  return {
    translatedBody: { messages: [{ role: "user", content: "Explain recursion." }] },
    finalFormat: FORMATS.OPENAI, upstreamModel: "gpt-4.1", model: "gpt-4.1", provider: "openai", reqTag: "test",
    tokenSaverEnabled: true, metaBreakEnabled: true,
    log: { line: vi.fn(), info: vi.fn() },
  };
}

describe("MetaBreak gateway phase", () => {
  it("applies the preset after other prompt additions and reports it", async () => {
    const params = { ...parameters(), cavemanEnabled: true, cavemanLevel: "full", ponytailEnabled: true, ponytailLevel: "full" };
    const result = await runTokenSavers(params);
    const messages = result.translatedBody.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: "Explain recursion." });
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("METABREAK OPERATING PROFILE");
    expect(params.log.line).toHaveBeenCalledWith("test", "⚙", expect.stringContaining("METABREAK"));
  });
  it.each([{ metaBreakEnabled: false }, { tokenSaverEnabled: false }])("does not mutate when disabled: %j", override => {
    const params = { ...parameters(), ...override };
    const original = structuredClone(params.translatedBody);
    return runTokenSavers(params).then(result => {
      expect(result.translatedBody).toEqual(original);
      expect(params.log.line).not.toHaveBeenCalled();
    });
  });
  it("reports skipped formats without claiming application", async () => {
    const params = { ...parameters(), finalFormat: FORMATS.KIRO };
    const original = structuredClone(params.translatedBody);
    expect((await runTokenSavers(params)).translatedBody).toEqual(original);
    expect(params.log.info).toHaveBeenCalledWith("METABREAK", "skipped: unsupported-format");
    expect(params.log.line).not.toHaveBeenCalled();
  });
});
