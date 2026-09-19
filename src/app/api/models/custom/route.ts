import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextRequest, NextResponse } from "next/server";
import { getCustomModels, addCustomModel, deleteCustomModel, deleteCustomModelsByProvider, pickDiscoveredMetadata } from "@/models";

// GET /api/models/custom - List all custom models
async function handleGET(): Promise<NextResponse> {
  try {
    const models = await getCustomModels();
    return NextResponse.json({ models });
  } catch (error) {
    console.error("Error fetching custom models:", error);
    return NextResponse.json({ error: "Failed to fetch custom models" }, { status: 500 });
  }
}

// POST /api/models/custom - Add custom model
async function handlePOST(request: NextRequest): Promise<NextResponse> {
  try {
    const { providerAlias, id, type, name, source, metadata } = await request.json();
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const added = await addCustomModel({
      providerAlias,
      id,
      type: type || "llm",
      name,
      source: source === "discovered" ? "discovered" : "manual",
      metadata: source === "discovered" ? pickDiscoveredMetadata(metadata) : {},
    });
    return NextResponse.json({ success: true, added });
  } catch (error) {
    console.error("Error adding custom model:", error);
    return NextResponse.json({ error: "Failed to add custom model" }, { status: 500 });
  }
}

// DELETE /api/models/custom?providerAlias=xxx&id=yyy&type=zzz
// DELETE /api/models/custom?providerAlias=xxx&all=1 - every model of a provider
async function handleDELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  try {
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    const type = searchParams.get("type") || "llm";
    // "Clear All Models" sent one request per model — hundreds of them once the
    // catalogue is discovered rather than shipped.
    if (providerAlias && !id && searchParams.get("all")) {
      const deleted = await deleteCustomModelsByProvider(providerAlias, type);
      return NextResponse.json({ success: true, deleted });
    }
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    await deleteCustomModel({ providerAlias, id, type });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting custom model:", error);
    return NextResponse.json({ error: "Failed to delete custom model" }, { status: 500 });
  }
}

export const GET = tenantRoute(handleGET);
export const POST = tenantRoute(handlePOST);
export const DELETE = tenantRoute(handleDELETE);
