import { NextRequest, NextResponse } from "next/server";
import { appendHarnessEvent, listHarnessEvents } from "@/lib/db/repos/harnessConversationsRepo";

export const dynamic = "force-dynamic";

interface EventRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: EventRouteContext) {
  const { id } = await context.params;
  const after = Math.max(0, Number(request.nextUrl.searchParams.get("after") || 0) || 0);
  return NextResponse.json({ events: await listHarnessEvents(id, after) });
}

export async function POST(request: NextRequest, context: EventRouteContext) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (typeof body.type !== "string" || !body.type || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return NextResponse.json({ error: "type and object data are required" }, { status: 400 });
  }
  const event = await appendHarnessEvent({ sessionId: id, type: body.type, data: body.data as Record<string, unknown> });
  return NextResponse.json({ event }, { status: 201 });
}
