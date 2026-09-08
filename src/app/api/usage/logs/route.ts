import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { getRecentLogs } from "@/lib/usageDb";

async function handleGET() {
  await assertRequestRuntime();
  try {
    const logs = await getRecentLogs(200);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("Error fetching logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}

export const GET = tenantRoute(handleGET);
