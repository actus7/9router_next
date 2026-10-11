import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Found by gatewayDockerLive: in the Docker build, modelPerf stayed empty even
 * with a globalThis slot — the seams installed by instrumentation.ts were not
 * the ones the route handlers saw. The request path now installs them itself,
 * idempotently, so it never depends on where Next runs the bootstrap.
 */
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => undefined),
}));
const write = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/db/repos/modelPerfRepo", () => ({ recordModelAttempt: write, readModelPerf: vi.fn(async () => []), pruneModelPerf: vi.fn(async () => {}) }));
vi.mock("@/lib/db/repos/apiKeysRepo", () => ({
  resolveApiKeyOwner: vi.fn(async () => ({ userId: "u1", id: "k1" })),
}));

import { gatewayRoute } from "@/server/application/http/gatewayRoute";
import { getErrorJudge, setErrorJudge } from "@/server/llm-gateway/engine/host/errorJudge";
import { getFusionJudge, setFusionJudge } from "@/server/llm-gateway/engine/host/fusionJudge";
import { recordAttemptDatum, setModelStatsStore } from "@/server/llm-gateway/engine/host/modelStats";
import { resetEngineSeamsForTests } from "@/server/llm-gateway/application/engineSeams";

afterEach(() => {
  setModelStatsStore(null);
  setErrorJudge(null);
  setFusionJudge(null);
  resetEngineSeamsForTests();
});

describe("engine seams are installed on the request path", () => {
  it("a gateway route handler runs with the stats store and both judges installed", async () => {
    let seen: { judge: boolean; fusion: boolean } | null = null;
    const route = gatewayRoute(async () => {
      seen = { judge: getErrorJudge() !== null, fusion: getFusionJudge() !== null };
      return new Response("ok");
    });
    await route(new Request("https://gw.test/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer sk-x" } }));
    expect(seen).toEqual({ judge: true, fusion: true });
  });

  it("the stats store it installs is the database one, not a no-op", async () => {
    const { ensureEngineSeams } = await import("@/server/llm-gateway/application/engineSeams");
    ensureEngineSeams();
    recordAttemptDatum({ modelKey: "a/m", outcome: "ok", ttftMs: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(write).toHaveBeenCalledWith({ modelKey: "a/m", outcome: "ok", ttftMs: 1 });
  });
});
