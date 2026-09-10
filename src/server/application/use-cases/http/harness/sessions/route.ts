import { NextRequest, NextResponse } from "next/server";
import { listHarnessConversations, syncHarnessConversations, type HarnessConversation } from "@/lib/db/repos/harnessConversationsRepo";
import { assertPublicUrl } from "@/shared/utils/ssrfGuard";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";


/** Bounds one request the way the run delete endpoint bounds its id list. */
const MAX_DELETED_IDS = 500;

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
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  return NextResponse.json({ sessions: await listHarnessConversations() });
}

export async function PUT(request: NextRequest) {
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (!Array.isArray(body.sessions) || !body.sessions.every(isConversation)) {
    return NextResponse.json({ error: "sessions must be an array of valid conversations" }, { status: 400 });
  }
  if (!body.sessions.every(hasOnlyPublicMcpUrls)) {
    return NextResponse.json({ error: "session mcpServers must use public URLs" }, { status: 400 });
  }
  // Deletions are named, never inferred from absence. A client that omits the
  // field — an old tab still running the previous bundle — upserts what it
  // sent and removes nothing, which is the safe reading.
  const deletedIds = Array.isArray(body.deletedIds)
    ? body.deletedIds.filter((id): id is string => typeof id === "string" && !!id)
    : [];
  if (deletedIds.length > MAX_DELETED_IDS) {
    return NextResponse.json({ error: `deletedIds must hold at most ${MAX_DELETED_IDS} ids` }, { status: 400 });
  }
  // `stale` names the conversations the server refused because it holds a
  // newer copy — the worker having written a finished answer into one while
  // this client was idle. The client re-reads those instead of pushing again.
  const { stale } = await syncHarnessConversations({ upserts: body.sessions, deletedIds });
  return NextResponse.json({ ok: true, stale });
}
// Application HTTP use case extracted from the Next.js route adapter.
