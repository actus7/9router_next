import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import {
  approvePendingWrite,
  listPendingMemoryWrites,
  rejectPendingWrite,
} from "@/server/harness/memory/applyMemoryWrite";
import { invalidateMemoryCache } from "@/server/harness/memory/context";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  await assertRequestRuntime();
  const pending = await listPendingMemoryWrites();
  return NextResponse.json({ ok: true, pending });
}

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  const decision = body.decision;
  if (!id) return badRequest("id is required");
  if (decision === "approve") {
    const result = await approvePendingWrite(id);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await invalidateMemoryCache()) });
  }
  if (decision === "reject") {
    await rejectPendingWrite(id);
    return NextResponse.json({ ok: true });
  }
  return badRequest("decision must be approve or reject");
}
