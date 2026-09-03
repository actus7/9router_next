import { describe, expect, it } from "vitest";
import { buildMemoryPromptBlock } from "@/shared/harness/agentMemory";
import { scanMemoryContent } from "@/server/harness/memory/securityScan";

describe("buildMemoryPromptBlock", () => {
  it("returns empty when no entries", () => {
    expect(
      buildMemoryPromptBlock({
        revision: 0,
        agent: [],
        user: [],
        agentChars: 0,
        userChars: 0,
        agentLimit: 2200,
        userLimit: 1375,
      }),
    ).toBe("");
  });

  it("includes agent and user sections", () => {
    const block = buildMemoryPromptBlock({
      revision: 1,
      agent: [
        {
          id: "a1",
          scope: "agent",
          content: "Use TypeScript",
          createdAt: "",
          updatedAt: "",
        },
      ],
      user: [
        {
          id: "u1",
          scope: "user",
          content: "Prefers Portuguese",
          createdAt: "",
          updatedAt: "",
        },
      ],
      agentChars: 14,
      userChars: 18,
      agentLimit: 2200,
      userLimit: 1375,
    });
    expect(block).toContain("Agent memory");
    expect(block).toContain("[a1] Use TypeScript");
    expect(block).toContain("User memory");
    expect(block).toContain("memory_add");
  });
});

describe("scanMemoryContent", () => {
  it("rejects empty content", () => {
    expect(scanMemoryContent("  ")).toEqual([
      expect.objectContaining({ code: "empty" }),
    ]);
  });

  it("flags likely secrets", () => {
    expect(scanMemoryContent("key is sk-abcdefghijklmnopqrstuvwxyz123456")).toEqual([
      expect.objectContaining({ code: "secret" }),
    ]);
  });
});
