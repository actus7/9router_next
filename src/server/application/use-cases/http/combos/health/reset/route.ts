import { NextResponse } from "next/server";
import { resetModelHealth } from "@/server/application/use-cases/modelHealth";

// POST /api/combos/health/reset - forget penalties, measurements and cooldowns
export async function POST(): Promise<NextResponse> {
  try {
    return NextResponse.json({ ok: true, ...(await resetModelHealth()) });
  } catch (error) {
    console.error("Error resetting model health:", error);
    return NextResponse.json({ error: "Failed to reset model health" }, { status: 500 });
  }
}
