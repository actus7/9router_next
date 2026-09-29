import { NextRequest, NextResponse } from "next/server";
import { getApiKeyProfile, updateApiKeyProfile } from "@/lib/db/repos/apiKeysRepo";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/keys/[id]/profile - Abilities and skills this key's requests get
export async function GET(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const profile = await getApiKeyProfile(id);
    if (!profile) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Error fetching key profile:", error);
    return NextResponse.json({ error: "Failed to fetch key profile" }, { status: 500 });
  }
}

// PUT /api/keys/[id]/profile - Merge a partial profile over the key's current one
export async function PUT(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Body must be a profile object" }, { status: 400 });
    }
    // Unknown fields and invalid values are dropped by normalization; what the
    // caller did not send keeps its current value.
    const profile = await updateApiKeyProfile(id, body);
    if (!profile) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Error updating key profile:", error);
    return NextResponse.json({ error: "Failed to update key profile" }, { status: 500 });
  }
}
