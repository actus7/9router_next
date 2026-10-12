import { NextResponse } from "next/server";
import { tenantRoute } from "@/server/application/http/tenantRoute";
import { refreshAllProviderCatalogs } from "@/server/application/use-cases/models/ensureProviderCatalog";

// One upstream listing per connected provider, four at a time.
export const maxDuration = 120;

/** POST /api/models/refresh-all — rediscover every connected provider's models now. */
async function handlePOST(): Promise<NextResponse> {
  try {
    return NextResponse.json({ results: await refreshAllProviderCatalogs() });
  } catch (error) {
    console.error("Refreshing all provider catalogs failed:", error);
    return NextResponse.json({ error: "Failed to refresh provider models" }, { status: 500 });
  }
}

export const POST = tenantRoute(handlePOST);
