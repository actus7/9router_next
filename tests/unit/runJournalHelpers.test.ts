import { describe, expect, it } from "vitest";
import { classifyEventKind } from "@/app/(dashboard)/dashboard/basic-chat/runJournalHelpers";
import type { HarnessEvent } from "@/app/(dashboard)/dashboard/basic-chat/types";

const event = (type: string): HarnessEvent => ({ sessionId: "s1", seq: 1, type, data: {}, createdAt: new Date().toISOString() });

describe("classifyEventKind", () => {
  it("classifies user/message as user", () => {
    expect(classifyEventKind(event("user/message"))).toBe("user");
  });

  it("classifies assistant/message and assistant/reasoning as assistant", () => {
    expect(classifyEventKind(event("assistant/message"))).toBe("assistant");
    expect(classifyEventKind(event("assistant/reasoning"))).toBe("assistant");
  });

  it("classifies run/start, run/complete, and run/end as system", () => {
    expect(classifyEventKind(event("run/start"))).toBe("system");
    expect(classifyEventKind(event("run/complete"))).toBe("system");
    expect(classifyEventKind(event("run/end"))).toBe("system");
  });

  it("classifies tool/call and tool/result as tool", () => {
    expect(classifyEventKind(event("tool/call"))).toBe("tool");
    expect(classifyEventKind(event("tool/result"))).toBe("tool");
  });

  it("falls back to context for anything unrecognized", () => {
    expect(classifyEventKind(event("unknown/thing"))).toBe("context");
  });
});
