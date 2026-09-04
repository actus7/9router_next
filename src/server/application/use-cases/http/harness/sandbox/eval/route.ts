import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { runSandboxCapability } from "@/server/plugin-core/sandbox/runSandboxCapability";
import { requireDashboardAccess } from "@/server/application/http/requireDashboardAccess";

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const denied = await requireDashboardAccess();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const source = typeof body.source === "string" ? body.source : "";
  const input =
    body.input && typeof body.input === "object" && !Array.isArray(body.input)
      ? (body.input as Record<string, unknown>)
      : {};
  const toolName = typeof body.tool_name === "string" ? body.tool_name : undefined;
  const result = await runSandboxCapability({ source, toolName, input });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
