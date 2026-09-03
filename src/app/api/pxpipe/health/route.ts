import { NextResponse } from "next/server";
import { runHealthCheck } from "@/lib/pxpipe/service";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";


export async function POST() {
  await assertRequestRuntime();
  try {
    const result = await runHealthCheck();
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json({ healthy: false, checks: [], error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

// GET mirrors POST so the card can probe on page load without a mutation call.
export const GET = POST;
