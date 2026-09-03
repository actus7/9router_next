import { NextResponse } from "next/server";
import { installPxpipe } from "@/lib/pxpipe/install";
import { unloadPxpipe } from "@/lib/pxpipe/loader";
import { runHealthCheck } from "@/lib/pxpipe/service";

// npm install can legitimately take minutes on a cold cache.
export const maxDuration = 300;

// Install (or repair — same operation, reinstalls @latest) then re-run the health check.
export async function POST() {
  try {
    const info = await installPxpipe();
    unloadPxpipe(); // drop any previously-loaded version so health loads the fresh one
    const health = await runHealthCheck();
    return NextResponse.json({ ...info, health });
  } catch (error: unknown) {
    const err = error as Error & { code?: string };
    return NextResponse.json({ error: err.message, code: err.code || null }, { status: 500 });
  }
}
