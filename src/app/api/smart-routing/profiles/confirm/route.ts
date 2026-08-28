import { NextRequest, NextResponse } from "next/server";
import { upsertSmartModelProfiles } from "@/lib/localDb";
import { refreshDeterministicSmartProfiles, invalidateSmartProfileCache, ROUTE_NEEDS, ROUTING_TIERS, type RouteNeed, type RoutingTier, type SmartModelProfile } from "@/server/llm-gateway/smart-routing";

function clamp(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    if (!Array.isArray(body.profiles) || body.profiles.length === 0) {
      return NextResponse.json({ error: "profiles must be a non-empty array" }, { status: 400 });
    }
    const inventory = await refreshDeterministicSmartProfiles();
    const currentByKey = new Map(inventory.map((profile) => [profile.modelKey, profile]));
    const source: SmartModelProfile["source"] = body.source === "manual" ? "manual" : "llm";
    const now = new Date().toISOString();
    const accepted: SmartModelProfile[] = [];

    for (const raw of body.profiles as Array<Record<string, unknown>>) {
      const base = currentByKey.get(String(raw.modelKey || ""));
      if (!base) continue;
      const rawScores = raw.needScores && typeof raw.needScores === "object" ? raw.needScores as Record<string, unknown> : {};
      const needScores: Partial<Record<RouteNeed, number>> = { ...base.needScores };
      for (const need of ROUTE_NEEDS) {
        if (rawScores[need] !== undefined) needScores[need] = clamp(rawScores[need], needScores[need] || 0.5);
      }
      const tier = ROUTING_TIERS.includes(raw.recommendedTier as RoutingTier) ? raw.recommendedTier as RoutingTier : base.recommendedTier;
      accepted.push({
        ...base,
        quality: clamp(raw.quality, base.quality),
        latencyScore: clamp(raw.latencyScore, base.latencyScore),
        reliabilityScore: clamp(raw.reliabilityScore, base.reliabilityScore),
        recommendedTier: tier,
        needScores,
        source,
        classifierModel: typeof body.classifierModel === "string" ? body.classifierModel : null,
        sources: Array.isArray(raw.sources) ? raw.sources.filter((item): item is string => typeof item === "string").slice(0, 12) : [],
        researchedAt: typeof body.researchedAt === "string" ? body.researchedAt : now,
        updatedAt: now,
      });
    }
    if (accepted.length === 0) return NextResponse.json({ error: "No profiles matched the current active inventory" }, { status: 400 });
    await upsertSmartModelProfiles(accepted);
    invalidateSmartProfileCache();
    return NextResponse.json({ profiles: accepted, saved: accepted.length });
  } catch (error) {
    console.error("Error confirming smart model profiles:", error);
    return NextResponse.json({ error: "Failed to save smart model profiles" }, { status: 500 });
  }
}
