import { NextRequest } from "next/server";

import { currentTenantId, withTenant } from "@/lib/db/tenant";
import {
  STALE_RUN_MS,
  failStaleHarnessRuns,
  getHarnessRun,
  type HarnessRun,
} from "@/lib/db/repos/harnessRunsRepo";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";

/**
 * How often the row is re-read while a run is live.
 *
 * The worker may be in a different serverless invocation than this reader, so
 * there is no in-process event to subscribe to — the database is the only
 * channel between them. Polling it is the honest implementation of that.
 */
const POLL_INTERVAL_MS = 700;

/**
 * A hard ceiling on how long one watcher may poll.
 *
 * Nothing should reach it: the loop ends when the run settles, when the reader
 * cancels, or when the request aborts. It exists because this loop queries Neon
 * on a timer, and a watcher that somehow outlives all three would do so
 * forever. Comfortably past the 300s a run itself can take.
 */
const MAX_WATCH_MS = 10 * 60 * 1000;

/**
 * How many watchers one account may hold open at once.
 *
 * Each one polls Neon every 700ms for up to ten minutes, and the database is
 * shared by every tenant — so this is not about protecting the account that
 * opens them, it is about the accounts that did not. The dashboard rate limit
 * bounds how fast connections are *opened*, never how many stay open, which is
 * the quantity that costs anything here.
 *
 * Per-process, like the rate limiter it sits beside: on several instances the
 * real ceiling is this times the instance count, which still turns unbounded
 * into bounded.
 */
const MAX_WATCHERS_PER_ACCOUNT = 8;

const watchers: Map<string, number> = new Map();

function acquireWatcher(owner: string): boolean {
  const held = watchers.get(owner) ?? 0;
  if (held >= MAX_WATCHERS_PER_ACCOUNT) return false;
  watchers.set(owner, held + 1);
  return true;
}

function releaseWatcher(owner: string): void {
  const held = (watchers.get(owner) ?? 1) - 1;
  if (held <= 0) watchers.delete(owner);
  else watchers.set(owner, held);
}

/**
 * A reader that is watching an existing run, live or finished.
 *
 * It always sends the text accumulated so far before following along, so a
 * client that reconnects after a laptop lid closed sees the whole answer, not
 * only what arrives after it reconnected.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const denied = await requireDashboardAccess();
  if (denied) return denied;

  const { runId } = await context.params;
  const owner = currentTenantId();
  const encoder = new TextEncoder();

  // Reaping here too: a client watching a run whose worker was killed would
  // otherwise poll a row that never changes until it gives up.
  await failStaleHarnessRuns();

  const existing = await getHarnessRun(runId);
  if (!existing) {
    return new Response(JSON.stringify({ error: "Run not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Every way this watcher can end writes here, and the loop reads it before
  // each poll. It used to learn about a departed reader only by `enqueue`
  // throwing, which does happen — but a poll late, and never at all on the
  // branch that sends data instead of a ping. Being told beats finding out.
  if (!acquireWatcher(owner)) {
    return new Response(JSON.stringify({ error: "Too many open run watchers" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "5" },
    });
  }

  const state = { done: false };
  const stop = () => {
    state.done = true;
  };
  request.signal.addEventListener("abort", stop);

  const stream = new ReadableStream({
    async start(controller) {
      const deadline = Date.now() + MAX_WATCH_MS;
      let lastText = "";

      const send = (run: HarnessRun) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(run)}\n\n`));
        lastText = run.partialText;
      };

      try {
        send(existing);
        if (existing.status !== "running") return;

        while (!state.done && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          if (state.done) break;

          let run = await withTenant(owner, () => getHarnessRun(runId));
          if (!run) break; // Deleted while watched: the end, not an error.

          // A run whose worker died mid-write stays `running` forever, and a
          // watcher polling it never reaches a terminal state — so the client
          // awaiting this stream never settles either, and the composer it
          // belongs to stays disabled. Reaping only at connect time was not
          // enough: the worker can die *after* the watcher attached, which is
          // exactly what a dev-server recompile does to a run in flight.
          if (run.status === "running" && Date.now() - Date.parse(run.updatedAt) > STALE_RUN_MS) {
            await withTenant(owner, () => failStaleHarnessRuns());
            run = (await withTenant(owner, () => getHarnessRun(runId))) ?? run;
          }

          if (run.partialText !== lastText || run.status !== "running") {
            send(run);
            if (run.status !== "running") break;
          } else {
            controller.enqueue(encoder.encode(": ping\n\n"));
          }
        }
      } catch {
        // A read that failed or a consumer that went away. Either way this
        // watcher is finished; the worker neither knows nor cares.
      } finally {
        request.signal.removeEventListener("abort", stop);
        releaseWatcher(owner);
        stop();
        try {
          controller.close();
        } catch {
          // Already closed by the consumer.
        }
      }
    },

    // The consumer let go. `start` is still parked in its sleep, so this is the
    // only thing that tells it to stop.
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
