import { describe, expect, it } from "vitest";
import { finalizeStreamSuccess } from "@/app/(dashboard)/dashboard/basic-chat/hooks/finalizeStreamResult";
import type { ChatSession } from "@/app/(dashboard)/dashboard/basic-chat/types";

describe("finalizeStreamSuccess", () => {
  it("stores timing telemetry on the finalized message", () => {
    let session = {
      id: "s1",
      messages: [{ id: "assistant-1", role: "assistant", content: "", status: "streaming" as const }],
    } as unknown as ChatSession;
    const updateSession = (_id: string, updater: (s: ChatSession) => ChatSession) => { session = updater(session); };

    finalizeStreamSuccess("s1", "assistant-1", "hello", "hi", updateSession, () => {}, { timing: { ttftMs: 400, totalMs: 1200 } });

    expect(session.messages[0]!.timing).toEqual({ ttftMs: 400, totalMs: 1200 });
  });

  it("preserves the existing timing when telemetry omits it", () => {
    let session = {
      id: "s1",
      messages: [{ id: "assistant-1", role: "assistant", content: "", status: "streaming" as const, timing: { ttftMs: 100, totalMs: 500 } }],
    } as unknown as ChatSession;
    const updateSession = (_id: string, updater: (s: ChatSession) => ChatSession) => { session = updater(session); };

    finalizeStreamSuccess("s1", "assistant-1", "hello", "hi", updateSession, () => {});

    expect(session.messages[0]!.timing).toEqual({ ttftMs: 100, totalMs: 500 });
  });
});
