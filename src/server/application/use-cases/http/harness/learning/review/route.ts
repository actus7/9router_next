import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { runPostTurnReview } from "@/server/harness/learning/postTurnReview";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const runId = typeof body.runId === "string" ? body.runId : "";
  const userText = typeof body.userText === "string" ? body.userText : "";
  const assistantText = typeof body.assistantText === "string" ? body.assistantText : "";
  if (!sessionId || !runId) return badRequest("sessionId and runId are required");

  const result = await runPostTurnReview({
    sessionId,
    runId,
    userText,
    assistantText,
  });
  return NextResponse.json({ ok: true, ...result });
}
