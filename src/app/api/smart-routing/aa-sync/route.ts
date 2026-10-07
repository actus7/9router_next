import { NextResponse } from "next/server";
import { tenantRoute } from "@/server/application/http/tenantRoute";
import { syncAaNow } from "@/server/application/use-cases/smart-routing/syncAa";

/** Thin transport adapter for the manual Artificial Analysis sync button. */
async function handlePOST(): Promise<NextResponse> {
  try {
    return NextResponse.json({ aaMeta: await syncAaNow() });
  } catch (error) {
    // The message names the cause (missing key, AA status) and never the key.
    const message = error instanceof Error ? error.message : "Artificial Analysis sync failed";
    console.error("Artificial Analysis manual sync failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export const POST = tenantRoute(handlePOST);
