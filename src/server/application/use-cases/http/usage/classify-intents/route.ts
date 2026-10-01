import { NextRequest, NextResponse } from "next/server";

import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { classifyUsageIntents } from "@/server/application/use-cases/usage/classifyUsageIntents";

/**
 * POST /api/usage/classify-intents
 * Classifies what recent usage was for (Jev `usageTaxonomy`) and stores the
 * per-intent counts. Body: `{ limit?: number }` (default 200, capped at 500).
 * Fail-open: answers `{ classified: 0 }` and writes nothing when Jev is silent.
 */
export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  try {
    const body = (await request.json().catch(() => null)) as { limit?: unknown } | null;
    const result = await classifyUsageIntents(
      body && typeof body.limit === "number" ? { limit: body.limit } : undefined,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("[API] Failed to classify usage intents:", error);
    return NextResponse.json({ error: "Failed to classify usage intents" }, { status: 500 });
  }
}
// Application HTTP use case extracted from the Next.js route adapter.
