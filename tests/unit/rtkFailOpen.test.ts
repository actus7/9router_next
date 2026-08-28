import { describe, it, expect } from "vitest";
import { compressMessages, formatRtkLog } from "@/lib/open-sse/rtk";

// ── (a) null/undefined input → returns null (no throw) ──────────────────────
describe("compressMessages fail-open: null/undefined input", () => {
  it("null body → null", () => {
    expect(compressMessages(null, true)).toBeNull();
  });

  it("undefined body → null", () => {
    expect(compressMessages(undefined, true)).toBeNull();
  });

  it("enabled=false → null regardless of body", () => {
    expect(compressMessages({ messages: [{ role: "user", content: "hi" }] }, false)).toBeNull();
  });
});

// ── (b) body with empty messages → no crash ─────────────────────────────────
describe("compressMessages: empty / missing messages", () => {
  it("empty messages array → returns stats with no hits", () => {
    const result = compressMessages({ messages: [] }, true);
    expect(result).toBeDefined();
    expect(result!.hits).toEqual([]);
    expect(result!.bytesBefore).toBe(0);
    expect(result!.bytesAfter).toBe(0);
  });

  it("no messages and no input → null", () => {
    expect(compressMessages({ model: "gpt-4o" }, true)).toBeNull();
  });

  it("messages with null entries → no crash", () => {
    const body = { messages: [null, undefined, { role: "user", content: "hi" }] };
    expect(() => compressMessages(body, true)).not.toThrow();
  });
});

// ── (c) huge tool_result (50KB) + enabled → never throws ────────────────────
describe("compressMessages: large payloads never throw", () => {
  it("50KB string tool_result → returns stats, never throws", () => {
    const hugeContent = "x".repeat(50 * 1024);
    const body = {
      messages: [{ role: "tool", content: hugeContent }],
    };
    let result: ReturnType<typeof compressMessages>;
    expect(() => { result = compressMessages(body, true); }).not.toThrow();
    expect(result!).toBeDefined();
    expect(result!.bytesBefore).toBeGreaterThan(0);
  });

  it("50KB Claude tool_result block → returns stats, never throws", () => {
    const hugeContent = "x".repeat(50 * 1024);
    const body = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_result", content: hugeContent },
          ],
        },
      ],
    };
    expect(() => compressMessages(body, true)).not.toThrow();
  });

  it("OpenAI Responses function_call_output → returns stats, never throws", () => {
    const hugeContent = "x".repeat(50 * 1024);
    const body = {
      input: [{ type: "function_call_output", output: hugeContent }],
    };
    expect(() => compressMessages(body, true)).not.toThrow();
  });
});

// ── (d) is_error: true tool results are NOT compressed ──────────────────────
describe("compressMessages: is_error=true skipped", () => {
  it("Claude is_error=true tool_result → no compression hits", () => {
    const errorContent = "Error trace: ".repeat(200); // well above MIN_COMPRESS_SIZE
    const body = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_result", is_error: true, content: errorContent },
          ],
        },
      ],
    };
    const result = compressMessages(body, true);
    expect(result).toBeDefined();
    // is_error blocks must be skipped — zero hits
    expect(result!.hits).toEqual([]);
  });

  it("Kiro status:'error' tool result → no compression hits", () => {
    const errorContent = "Error trace: ".repeat(200);
    const body = {
      conversationState: {
        history: [
          {
            userInputMessage: {
              userInputMessageContext: [
                { status: "error", content: [{ text: errorContent }] },
              ],
            },
          },
        ],
      },
    };
    const result = compressMessages(body, true);
    expect(result).toBeDefined();
    expect(result!.hits).toEqual([]);
  });
});

// ── formatRtkLog ─────────────────────────────────────────────────────────────
describe("formatRtkLog", () => {
  it("null → null", () => {
    expect(formatRtkLog(null)).toBeNull();
  });

  it("undefined → null", () => {
    expect(formatRtkLog(undefined)).toBeNull();
  });

  it("empty hits → null", () => {
    expect(formatRtkLog({ bytesBefore: 100, bytesAfter: 100, hits: [] })).toBeNull();
  });

  it("with hits → formatted string containing [RTK]", () => {
    const stats = {
      bytesBefore: 10000,
      bytesAfter: 3000,
      hits: [{ shape: "openai-tool", filter: "git-diff", saved: 7000 }],
    };
    const log = formatRtkLog(stats);
    expect(log).toContain("[RTK]");
    expect(log).toContain("saved");
    expect(log).toContain("7000B");
  });
});
