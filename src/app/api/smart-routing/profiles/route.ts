import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextRequest, NextResponse } from "next/server";
import { getDeterministicSmartProfiles } from "@/server/application/use-cases/smart-routing/getDeterministicProfiles";
import { refreshDeterministicSmartProfiles, type SmartModelProfile } from "@/server/llm-gateway/smart-routing";
import { enrichProfilesWithAa, syncAaSnapshotIfStale } from "@/server/application/use-cases/smart-routing/artificialAnalysis";

/**
 * AA metrics/prices for models the catalog has none for, so the board shows a
 * price where it can. Fail-open like the sync underneath: an unreachable
 * snapshot returns the inventory untouched.
 */
async function enrichInventory(profiles: SmartModelProfile[]): Promise<SmartModelProfile[]> {
  const aa = await syncAaSnapshotIfStale();
  return enrichProfilesWithAa(profiles, aa).profiles;
}

async function handleGET(): Promise<NextResponse> {
  try {
    const profiles = await getDeterministicSmartProfiles();
    return NextResponse.json({ profiles: await enrichInventory(profiles) });
  } catch (error) {
    console.error("Error loading smart model profiles:", error);
    return NextResponse.json({ error: "Failed to load smart model profiles" }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action && body.action !== "refresh") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }
    const profiles = await refreshDeterministicSmartProfiles(true);
    return NextResponse.json({ profiles: await enrichInventory(profiles), refreshedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Error refreshing smart model profiles:", error);
    return NextResponse.json({ error: "Failed to refresh smart model profiles" }, { status: 500 });
  }
}

export const GET = tenantRoute(handleGET);
export const POST = tenantRoute(handlePOST);
