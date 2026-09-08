import { tenantRoute } from "@/server/application/http/tenantRoute";
import { NextRequest, NextResponse } from "next/server";
import { getModelAliases, setModelAlias, deleteModelAlias } from "@/models";


// GET /api/models/alias - Get all aliases
async function handleGET(): Promise<NextResponse> {
  try {
    const aliases = await getModelAliases();
    return NextResponse.json({ aliases });
  } catch (error) {
    console.error("Error fetching aliases:", error);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}

// PUT /api/models/alias - Set model alias
async function handlePUT(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    await setModelAlias(alias, model);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.error("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}

// DELETE /api/models/alias?alias=xxx - Delete alias
async function handleDELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  try {
    const alias = searchParams.get("alias");

    if (!alias) {
      return NextResponse.json({ error: "Alias required" }, { status: 400 });
    }

    await deleteModelAlias(alias);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting alias:", error);
    return NextResponse.json({ error: "Failed to delete alias" }, { status: 500 });
  }
}

export const GET = tenantRoute(handleGET);
export const PUT = tenantRoute(handlePUT);
export const DELETE = tenantRoute(handleDELETE);
