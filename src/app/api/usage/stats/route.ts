import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextRequest, NextResponse  } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { getUsageStats } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);


async function handleGET(request: NextRequest) {
  await assertRequestRuntime();
  const { searchParams } = new URL(request.url);
  try {
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const stats = await getUsageStats(period);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("[API] Failed to get usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}

export const GET = tenantRoute(handleGET);
