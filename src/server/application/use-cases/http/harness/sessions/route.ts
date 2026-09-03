import { NextRequest, NextResponse } from "next/server";
import { listHarnessConversations, replaceHarnessConversations, type HarnessConversation } from "@/lib/db/repos/harnessConversationsRepo";
import { assertPublicUrl } from "@/shared/utils/ssrfGuard";


function isConversation(value: unknown): value is HarnessConversation {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["id", "title", "createdAt", "updatedAt"].every((key) => typeof item[key] === "string" && item[key]);
}

// Rejects a session whose mcpServers carry a non-public URL, so a crafted
// sync payload cannot smuggle an internal target past the discover-time
// SSRF guard and have it picked up later by /api/harness/mcp/call.
function hasOnlyPublicMcpUrls(conversation: HarnessConversation): boolean {
  const servers = conversation.mcpServers;
  if (!Array.isArray(servers)) return true;
  return servers.every((server) => {
    if (!server || typeof server !== "object") return true;
    const url = (server as Record<string, unknown>).url;
    if (typeof url !== "string") return true;
    try {
      assertPublicUrl(url);
      return true;
    } catch {
      return false;
    }
  });
}

export async function GET() {
  return NextResponse.json({ sessions: await listHarnessConversations() });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (!Array.isArray(body.sessions) || !body.sessions.every(isConversation)) {
    return NextResponse.json({ error: "sessions must be an array of valid conversations" }, { status: 400 });
  }
  if (!body.sessions.every(hasOnlyPublicMcpUrls)) {
    return NextResponse.json({ error: "session mcpServers must use public URLs" }, { status: 400 });
  }
  await replaceHarnessConversations(body.sessions);
  return NextResponse.json({ ok: true });
}
// Application HTTP use case extracted from the Next.js route adapter.
