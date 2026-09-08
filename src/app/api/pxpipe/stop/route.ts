import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextResponse } from "next/server";
import { unloadPxpipe } from "@/lib/pxpipe/loader";
import { getPxpipeStatus } from "@/lib/pxpipe/service";


// "Stop" in library mode = drop the in-process module; requests fail open to
// uncompressed passthrough until it is started again.
async function handlePOST() {
  try {
    const wasLoaded = unloadPxpipe();
    return NextResponse.json({ stopped: wasLoaded, ...getPxpipeStatus() });
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export const POST = tenantRoute(handlePOST);
