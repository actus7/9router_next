import { NextResponse } from "next/server";
import { unloadPxpipe, loadPxpipe } from "@/lib/pxpipe/loader";
import { getPxpipeStatus } from "@/lib/pxpipe/service";

export const dynamic = "force-dynamic";

// Reload the in-process module (picks up an upgraded install without a server restart).
export async function POST() {
  try {
    unloadPxpipe();
    await loadPxpipe();
    return NextResponse.json(getPxpipeStatus());
  } catch (error: unknown) {
    const err = error as Error & { code?: string };
    return NextResponse.json({ error: err.message, code: err.code || null }, { status: 500 });
  }
}
