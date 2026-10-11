import { afterEach, describe, expect, it, vi } from "vitest";

// Next compiles instrumentation.ts (where the bootstrap installs these seams)
// apart from the route handlers that read them: each gets its own copy of the
// module. Before this, a module-level `let` filled by the bootstrap stayed null
// for every request — modelPerf never got a row. resetModules stands in for
// "another bundle loading the same file".
afterEach(() => vi.resetModules());

describe("engine host seams survive a second copy of the module", () => {
  it("model stats store", async () => {
    const first = await import("@/server/llm-gateway/engine/host/modelStats");
    const recorded: string[] = [];
    first.setModelStatsStore({ record: (d) => recorded.push(d.modelKey), read: async () => new Map() });
    vi.resetModules();
    const second = await import("@/server/llm-gateway/engine/host/modelStats");
    second.recordAttemptDatum({ modelKey: "a/m", outcome: "ok", ttftMs: 1 });
    expect(recorded).toEqual(["a/m"]);
    second.setModelStatsStore(null);
  });

  it("error judge", async () => {
    const first = await import("@/server/llm-gateway/engine/host/errorJudge");
    const judge = async () => null;
    first.setErrorJudge(judge);
    vi.resetModules();
    const second = await import("@/server/llm-gateway/engine/host/errorJudge");
    expect(second.getErrorJudge()).toBe(judge);
    second.setErrorJudge(null);
  });

  it("fusion judge", async () => {
    const first = await import("@/server/llm-gateway/engine/host/fusionJudge");
    const judge = (async () => null) as unknown as Parameters<typeof first.setFusionJudge>[0];
    first.setFusionJudge(judge);
    vi.resetModules();
    const second = await import("@/server/llm-gateway/engine/host/fusionJudge");
    expect(second.getFusionJudge()).toBe(judge);
    second.setFusionJudge(null);
  });
});
