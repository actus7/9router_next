import { NextResponse } from "next/server";
import { runHealthCheck } from "@/lib/pxpipe/service";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { tenantRoute } from "@/server/application/http/tenantRoute";

async function handlePOST() {
  await assertRequestRuntime();
  try {
    const result = await runHealthCheck();
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json({ healthy: false, checks: [], error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const POST = tenantRoute(handlePOST);
// GET mirrors POST so the card can probe on page load without a mutation call.
export const GET = POST;
