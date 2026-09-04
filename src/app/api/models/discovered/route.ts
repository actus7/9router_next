import { NextRequest, NextResponse } from "next/server";
import { getCustomModels, syncDiscoveredCustomModels, pickDiscoveredMetadata } from "@/models";

// POST /api/models/discovered - atomically replace a provider's discovered LLM snapshot.
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { providerAlias, models } = await request.json();
    if (typeof providerAlias !== "string" || !providerAlias || !Array.isArray(models)) {
      return NextResponse.json({ error: "providerAlias and models[] required" }, { status: 400 });
    }
    const discovered = models.flatMap((model: unknown) => {
      if (!model || typeof model !== "object") return [];
      const entry = model as Record<string, unknown>;
      const id = typeof entry.id === "string" ? entry.id : typeof entry.name === "string" ? entry.name : "";
      if (!id) return [];
      return [{
        providerAlias,
        id,
        type: "llm",
        name: typeof entry.name === "string" ? entry.name : id,
        source: "discovered" as const,
        metadata: pickDiscoveredMetadata(entry),
      }];
    });
    await syncDiscoveredCustomModels(providerAlias, discovered);
    return NextResponse.json({ success: true, models: await getCustomModels() });
  } catch (error) {
    console.error("Error synchronizing discovered models:", error);
    return NextResponse.json({ error: "Failed to synchronize discovered models" }, { status: 500 });
  }
}
