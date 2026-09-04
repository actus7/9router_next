import { NextRequest, NextResponse } from "next/server";
import { testSingleConnection } from "./testUtils";

// POST /api/providers/[id]/test - Test connection
export async function POST(request: NextRequest, { params }: RouteContext<"/api/providers/[id]/test">): Promise<NextResponse> {
  try {
    const { id } = await params;
    const result = await testSingleConnection(id);

    if (result.error === "Connection not found") {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // testSingleConnection measures latency and can return a diagnosis; the
    // route used to drop both, so the dashboard had nothing to show beyond a
    // pass/fail dot. Additive fields: existing callers read what they need.
    return NextResponse.json({
      valid: result.ok,
      error: result.error,
      refreshed: result.refreshed || false,
      latencyMs: result.latencyMs,
      testedAt: result.testedAt,
      ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : {}),
      ...(result.diagnosis !== undefined ? { diagnosis: result.diagnosis } : {}),
    });
  } catch (error) {
    console.error("Error testing connection:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
