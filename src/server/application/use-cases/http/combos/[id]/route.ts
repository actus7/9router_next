import { NextRequest, NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName } from "@/lib/db/repos/combosRepo";
import { resetComboRotation } from "@/server/llm-gateway/catalog";
import { DEFAULT_SMART_ROUTING_CONFIG, validateSmartRoutingConfig } from "@/server/llm-gateway/smart-routing";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// GET /api/combos/[id] - Get combo by ID
export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const combo = await getComboById(id);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    
    return NextResponse.json(combo);
  } catch (error) {
    console.error("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

// PUT /api/combos/[id] - Update combo
export async function PUT(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    
    // Validate name format if provided
    if (body.name) {
      if (!VALID_NAME_REGEX.test(body.name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
      }
      
      // Check if name already exists (exclude current combo)
      const existing = await getComboByName(body.name);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }

    if (body.models !== undefined && !Array.isArray(body.models)) {
      return NextResponse.json({ error: "Models must be an array" }, { status: 400 });
    }
    const prev = await getComboById(id);
    if (!prev) return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    const nextKind = body.kind !== undefined ? body.kind : prev.kind;
    if (nextKind === "smart") {
      const validation = validateSmartRoutingConfig(body.routing ?? prev.routing ?? DEFAULT_SMART_ROUTING_CONFIG);
      if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
      body.routing = validation.config;
    } else if (body.routing !== undefined) {
      body.routing = null;
    }
    if (Array.isArray(body.models)) body.models = body.models.filter((model: unknown): model is string => typeof model === "string");
    
    // Capture previous name to invalidate rotation state on rename
    const combo = await updateCombo(id, body);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    // Invalidate rotation state (models/strategy/name may have changed)
    if (prev?.name) resetComboRotation(prev.name);
    if (combo.name && combo.name !== prev?.name) resetComboRotation(combo.name);

    return NextResponse.json(combo);
  } catch (error) {
    console.error("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

// DELETE /api/combos/[id] - Delete combo
export async function DELETE(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await params;
    const prev = await getComboById(id);
    const success = await deleteCombo(id);
    
    if (!success) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    if (prev?.name) resetComboRotation(prev.name);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
