import { NextRequest, NextResponse } from "next/server";
import { refreshDeterministicSmartProfiles } from "@/server/llm-gateway/smart-routing";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const profiles = await refreshDeterministicSmartProfiles();
    return NextResponse.json({ profiles });
  } catch (error) {
    console.error("Error loading smart model profiles:", error);
    return NextResponse.json({ error: "Failed to load smart model profiles" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action && body.action !== "refresh") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }
    const profiles = await refreshDeterministicSmartProfiles(true);
    return NextResponse.json({ profiles, refreshedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Error refreshing smart model profiles:", error);
    return NextResponse.json({ error: "Failed to refresh smart model profiles" }, { status: 500 });
  }
}

