import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { searchPastSessionMessages } from "@/lib/db/repos/harnessMessageIndexRepo";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return badRequest("query is required");
  const limit =
    typeof body.max_results === "number"
      ? Math.floor(body.max_results)
      : undefined;
  const excludeSessionId =
    typeof body.exclude_session_id === "string"
      ? body.exclude_session_id
      : undefined;
  const results = await searchPastSessionMessages({
    query,
    limit,
    excludeSessionId,
  });
  return NextResponse.json({ ok: true, results });
}
