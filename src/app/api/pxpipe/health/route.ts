import { NextResponse } from "next/server";
import { runHealthCheck } from "@/lib/pxpipe/service";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runHealthCheck();
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json({ healthy: false, checks: [], error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

// GET mirrors POST so the card can probe on page load without a mutation call.
export const GET = POST;
