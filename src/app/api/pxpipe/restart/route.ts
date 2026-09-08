import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextResponse } from "next/server";
import { unloadPxpipe, loadPxpipe } from "@/lib/pxpipe/loader";
import { getPxpipeStatus } from "@/lib/pxpipe/service";


// Reload the in-process module (picks up an upgraded install without a server restart).
async function handlePOST() {
  try {
    unloadPxpipe();
    await loadPxpipe();
    return NextResponse.json(getPxpipeStatus());
  } catch (error: unknown) {
    const err = error as Error & { code?: string };
    return NextResponse.json({ error: err.message, code: err.code || null }, { status: 500 });
  }
}

export const POST = tenantRoute(handlePOST);
