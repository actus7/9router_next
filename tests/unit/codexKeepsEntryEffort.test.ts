import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { CodexExecutor } from "@/server/llm-gateway/engine/executors/codex";

describe("codex executor keeps a configured reasoning effort", () => {
  it("does not overwrite reasoning.effort set by the lane entry", () => {
    const executor = new CodexExecutor();
    const out = executor.transformRequest("gpt-5.6-terra", { model: "gpt-5.6-terra", input: [], reasoning: { effort: "xhigh" } }, true, { accessToken: "t" } as never) as Record<string, unknown>;
    expect((out.reasoning as { effort?: string }).effort).toBe("xhigh");
  });
});
