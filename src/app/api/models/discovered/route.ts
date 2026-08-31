import { NextRequest, NextResponse } from "next/server";
import { getCustomModels, syncDiscoveredCustomModels } from "@/models";

export const dynamic = "force-dynamic";

const DISCOVERED_MODEL_METADATA_KEYS = new Set([
  "description", "context_length", "contextLength", "contextWindow", "max_output_tokens", "maxOutputTokens",
  "capabilities", "modalities", "input_modalities", "output_modalities", "owned_by", "provider",
  "upstreamModelId", "quotaFamily", "version",
]);

function pickDiscoveredMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => DISCOVERED_MODEL_METADATA_KEYS.has(key)));
}

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
