import { NextResponse } from "next/server";
import { getModelHealth } from "@/server/application/use-cases/modelHealth";

// GET /api/combos/health - what the gateway currently thinks of each model
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ models: await getModelHealth() });
  } catch (error) {
    console.error("Error reading model health:", error);
    return NextResponse.json({ error: "Failed to read model health" }, { status: 500 });
  }
}
