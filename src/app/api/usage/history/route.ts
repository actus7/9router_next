import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { getUsageStats } from "@/lib/usageDb";

async function handleGET() {
  await assertRequestRuntime();
  try {
    const stats = await getUsageStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}

export const GET = tenantRoute(handleGET);
