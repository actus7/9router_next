import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";

async function handleGET() {
  await assertRequestRuntime();
  try {
    const logs = await getRecentLogs(200);
    return NextResponse.json(logs);
  } catch (error: unknown) {
    console.error("[API ERROR] /api/usage/logs failed:", error);
    console.error("[API ERROR] Stack:", (error as Error)?.stack);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}

export const GET = tenantRoute(handleGET);
