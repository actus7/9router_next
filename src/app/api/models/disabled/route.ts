import { NextRequest, NextResponse } from "next/server";
import { getDisabledModels, disableModels, enableModels } from "@/lib/disabledModelsDb";


// GET /api/models/disabled?providerAlias=xxx
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  try {
    const providerAlias = searchParams.get("providerAlias");
    const all = await getDisabledModels();
    if (providerAlias) return NextResponse.json({ ids: all[providerAlias] || [] });
    return NextResponse.json({ disabled: all });
  } catch (error) {
    console.error("Error fetching disabled models:", error);
    return NextResponse.json({ error: "Failed to fetch disabled models" }, { status: 500 });
  }
}

// POST /api/models/disabled  body: { providerAlias, ids: [...], action?: "enable" }
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { providerAlias, ids, action } = await request.json();
    if (!providerAlias || !Array.isArray(ids)) {
      return NextResponse.json({ error: "providerAlias and ids[] required" }, { status: 400 });
    }
    if (action === "enable") await enableModels(providerAlias, ids);
    else await disableModels(providerAlias, ids);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error disabling models:", error);
    return NextResponse.json({ error: "Failed to disable models" }, { status: 500 });
  }
}

// DELETE /api/models/disabled?providerAlias=xxx[&id=yyy][&id=zzz]
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  try {
    const providerAlias = searchParams.get("providerAlias");
    const ids = searchParams.getAll("id").filter(Boolean);
    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }
    await enableModels(providerAlias, ids);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error enabling models:", error);
    return NextResponse.json({ error: "Failed to enable models" }, { status: 500 });
  }
}
