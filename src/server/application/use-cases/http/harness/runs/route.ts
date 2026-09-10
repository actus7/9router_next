import { NextRequest, NextResponse } from "next/server";

import {
  MAX_CONCURRENT_RUNS,
  countRunningHarnessRuns,
  deleteHarnessRuns,
  failStaleHarnessRuns,
  listHarnessRunStates,
  listHarnessRunsSince,
  stopHarnessRun,
} from "@/lib/db/repos/harnessRunsRepo";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";
import { startDurableRun } from "@/server/application/use-cases/harness/durableRun";

/** One page of runs is 200; a client never legitimately drops more at once. */
const MAX_DELETE_IDS = 200;

/**
 * Runs the client has not folded into its local conversation yet.
 *
 * This is what makes "close the laptop, come back tomorrow" work: the browser
 * asks what happened while it was gone and applies the answers it finds. Stale
 * runs are reaped on the way in, because this is the moment someone is present
 * to be told a run died.
 */
export async function GET(request: NextRequest) {
  const denied = await requireDashboardAccess();
  if (denied) return denied;

  await failStaleHarnessRuns();

  // No session named: the history list asking which conversations are working.
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ states: await listHarnessRunStates() });
  }
  const since = request.nextUrl.searchParams.get("since");
  return NextResponse.json({ runs: await listHarnessRunsSince(sessionId, since) });
}

export async function POST(request: NextRequest) {
  const denied = await requireDashboardAccess();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sessionId = body.sessionId;
  const messageId = body.messageId;
  const payload = body.body;
  if (typeof sessionId !== "string" || !sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (typeof messageId !== "string" || !messageId) {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "body must be a chat completions payload" }, { status: 400 });
  }
  if (typeof (payload as Record<string, unknown>).model !== "string") {
    return NextResponse.json({ error: "body.model is required" }, { status: 400 });
  }

  // Each run holds an invocation open and spends this account's provider
  // quota, and the dashboard rate limit only bounds how fast they are started,
  // not how many are alive at once. Refusing here is kinder than letting a
  // runaway client burn the quota and then wondering where it went.
  if ((await countRunningHarnessRuns()) >= MAX_CONCURRENT_RUNS) {
    return NextResponse.json(
      { error: `Too many runs in flight (limit ${MAX_CONCURRENT_RUNS}). Wait for one to finish.` },
      { status: 429 },
    );
  }

  const { runId } = await startDurableRun({
    sessionId,
    messageId,
    body: payload as Record<string, unknown>,
    authorization: request.headers.get("authorization"),
  });
  return NextResponse.json({ runId }, { status: 202 });
}

/** Drops runs the client has finished absorbing, so the table stays small. */
export async function DELETE(request: NextRequest) {
  const denied = await requireDashboardAccess();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!Array.isArray(body.ids) || !body.ids.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "ids must be an array of run ids" }, { status: 400 });
  }
  // Bounded because the ids become one `IN (...)` list: an unbounded array is a
  // client-authored query the size of its request body.
  if (body.ids.length > MAX_DELETE_IDS) {
    return NextResponse.json({ error: `ids must contain at most ${MAX_DELETE_IDS} entries` }, { status: 400 });
  }
  await deleteHarnessRuns(body.ids as string[]);
  return NextResponse.json({ ok: true });
}

/**
 * Stop a run on purpose.
 *
 * Distinct from merely closing the tab, which is exactly what this feature
 * exists to survive. Only an explicit stop reaches here.
 */
export async function PATCH(request: NextRequest) {
  const denied = await requireDashboardAccess();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.runId !== "string" || !body.runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }
  await stopHarnessRun(body.runId);
  return NextResponse.json({ ok: true });
}
