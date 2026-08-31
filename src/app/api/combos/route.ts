import { NextRequest, NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName } from "@/lib/db/repos/combosRepo";
import { DEFAULT_SMART_ROUTING_CONFIG, validateSmartRoutingConfig } from "@/server/llm-gateway/smart-routing";

export const dynamic = "force-dynamic";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// GET /api/combos - Get all combos
export async function GET(): Promise<NextResponse> {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.error("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { name, models, kind } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    if (models !== undefined && !Array.isArray(models)) {
      return NextResponse.json({ error: "Models must be an array" }, { status: 400 });
    }
    const routingValidation = validateSmartRoutingConfig(kind === "smart" ? (body.routing || DEFAULT_SMART_ROUTING_CONFIG) : null);
    if (!routingValidation.ok) return NextResponse.json({ error: routingValidation.error }, { status: 400 });

    const combo = await createCombo({
      name,
      models: (models || []).filter((model: unknown): model is string => typeof model === "string"),
      kind: kind || null,
      routing: kind === "smart" ? routingValidation.config as unknown as Record<string, unknown> : null,
    });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.error("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
