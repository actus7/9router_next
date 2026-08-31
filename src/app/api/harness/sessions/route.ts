import { NextRequest, NextResponse } from "next/server";
import { listHarnessConversations, replaceHarnessConversations, type HarnessConversation } from "@/lib/db/repos/harnessConversationsRepo";

export const dynamic = "force-dynamic";

function isConversation(value: unknown): value is HarnessConversation {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["id", "title", "createdAt", "updatedAt"].every((key) => typeof item[key] === "string" && item[key]);
}

export async function GET() {
  return NextResponse.json({ sessions: await listHarnessConversations() });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (!Array.isArray(body.sessions) || !body.sessions.every(isConversation)) {
    return NextResponse.json({ error: "sessions must be an array of valid conversations" }, { status: 400 });
  }
  await replaceHarnessConversations(body.sessions);
  return NextResponse.json({ ok: true });
}
