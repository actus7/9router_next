import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  approvePendingWrite,
  listPendingWrites,
  rejectPendingWrite,
} from "@/server/harness/memory/applyMemoryWrite";
import { invalidateMemoryCache } from "@/server/harness/memory/context";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const pending = await listPendingWrites();
  return NextResponse.json({ ok: true, pending });
}

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  const decision = body.decision;
  if (!id) return badRequest("id is required");
  if (decision === "approve") {
    const result = await approvePendingWrite(id);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    const memory = result.kind === "memory" ? await invalidateMemoryCache() : {};
    return NextResponse.json({ ok: true, kind: result.kind, action: result.action, outcome: result.outcome, ...memory });
  }
  if (decision === "reject") {
    const result = await rejectPendingWrite(id);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, kind: result.kind, action: result.action, outcome: result.outcome });
  }
  return badRequest("decision must be approve or reject");
}
