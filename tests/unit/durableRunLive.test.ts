import { describe, expect, it } from "vitest";

import { withTenant } from "@/lib/db/tenant";
import { getHarnessRun, deleteHarnessRuns } from "@/lib/db/repos/harnessRunsRepo";
import { startDurableRun } from "@/server/application/use-cases/harness/durableRun";

/**
 * The one test that touches the real database and a real provider.
 *
 * Everything else in this suite mocks at least one edge, which is how the
 * durable-run work reached a user still broken twice: the pieces were each
 * proven against a stub. This proves the whole path — `startDurableRun` writes
 * a row, the background worker calls the account's real provider through the
 * gateway, the answer lands in Neon, and a reader that was never connected can
 * pick it up.
 *
 * Off by default: it spends provider quota and needs `DATABASE_URL`, so it is
 * a deliberate act, not something `npm run check` should do on every run.
 *
 *   LIVE_RUN=1 LIVE_RUN_USER=<uuid> LIVE_RUN_MODEL=<model> npx vitest run tests/unit/durableRunLive.test.ts
 */
const live = process.env.LIVE_RUN === "1" && !!process.env.LIVE_RUN_USER;

describe.skipIf(!live)("durable run against the real stack", () => {
  it("produces an answer nobody stayed connected for", async () => {
    const owner = String(process.env.LIVE_RUN_USER);
    const model = process.env.LIVE_RUN_MODEL || "glm-5-turbo";

    const { runId } = await withTenant(owner, () =>
      startDurableRun({
        sessionId: `live-check-${Date.now()}`,
        messageId: `live-msg-${Date.now()}`,
        body: {
          model,
          messages: [{ role: "user", content: "Reply with exactly: DURABLE OK" }],
        },
        // A real key belonging to this same account: the worker only forwards
        // one it can prove the caller owns, so this exercises that check too.
        authorization: process.env.LIVE_RUN_KEY ? `Bearer ${process.env.LIVE_RUN_KEY}` : null,
      }),
    );

    expect(runId).toBeTruthy();

    // Nothing is watching the stream — the only way this settles is the worker
    // finishing on its own, which is the entire claim being tested.
    const deadline = Date.now() + 90_000;
    let run = await withTenant(owner, () => getHarnessRun(runId));
    while (run?.status === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      run = await withTenant(owner, () => getHarnessRun(runId));
    }

    // Reported before the assertions so a provider-side failure reads as
    // itself rather than as a broken durable run.
    console.log(`[live] status=${run?.status} error=${run?.error ?? "none"} text=${JSON.stringify(run?.partialText?.slice(0, 120))}`);

    try {
      expect(run).not.toBeNull();
      expect(run!.status).toBe("completed");
      expect(run!.partialText.length).toBeGreaterThan(0);
    } finally {
      // Kept when it failed: the row is the only record of why, and this test
      // exists precisely to surface a failure that mocks cannot produce.
      if (run?.status === "completed") await withTenant(owner, () => deleteHarnessRuns([runId]));
    }
  }, 120_000);
});
