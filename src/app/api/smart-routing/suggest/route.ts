import { NextRequest, NextResponse } from "next/server";
import { refreshDeterministicSmartProfiles, type SmartModelProfile } from "@/server/llm-gateway/smart-routing";
import { handleSingleModelChat } from "@/server/llm-gateway/chat";
import { handleSearch } from "@/server/llm-gateway/search";

const BATCH_SIZE = 30;
const MAX_PROFILES = 180;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function responseText(payload: unknown): string {
  const root = asRecord(payload);
  const choice = Array.isArray(root.choices) ? asRecord(root.choices[0]) : {};
  const message = asRecord(choice.message);
  if (typeof message.content === "string") return message.content;
  const content = Array.isArray(root.content) ? asRecord(root.content[0]) : {};
  if (typeof content.text === "string") return content.text;
  if (Array.isArray(root.output)) {
    for (const item of root.output) {
      const blocks = asRecord(item).content;
      if (!Array.isArray(blocks)) continue;
      const block = blocks.map(asRecord).find((candidate) => typeof candidate.text === "string");
      if (typeof block?.text === "string") return block.text;
    }
  }
  return "";
}

function parseSuggestions(payload: unknown): Array<Record<string, unknown>> {
  const text = responseText(payload);
  try {
    const parsed: unknown = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
    const values = Array.isArray(parsed) ? parsed : asRecord(parsed).profiles;
    return Array.isArray(values) ? values.map(asRecord) : [];
  } catch {
    return [];
  }
}

function chooseClassifier(profiles: SmartModelProfile[], requested?: string): SmartModelProfile | null {
  if (requested) {
    const explicit = profiles.find((profile) => profile.modelKey === requested && profile.capabilities.serviceKinds.includes("llm"));
    if (explicit) return explicit;
  }
  return profiles
    .filter((profile) => profile.capabilities.serviceKinds.includes("llm"))
    .sort((a, b) => {
      const aScore = a.quality + (a.capabilities.search ? 0.08 : 0) + a.reliabilityScore * 0.15;
      const bScore = b.quality + (b.capabilities.search ? 0.08 : 0) + b.reliabilityScore * 0.15;
      return bScore - aScore;
    })[0] || null;
}

async function researchInventory(request: NextRequest, profiles: SmartModelProfile[]): Promise<{ evidence: string; provider?: string }> {
  const searchProfile = profiles.find((profile) => profile.capabilities.serviceKinds.includes("webSearch"));
  if (!searchProfile) return { evidence: "" };
  const names = profiles.slice(0, 60).map((profile) => profile.model).join(", ");
  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  const authorization = request.headers.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  try {
    const response = await handleSearch(new Request("http://localhost/v1/search", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: searchProfile.provider,
        query: `Find official or primary documentation about capabilities, context limits, pricing, and intended use for these AI models: ${names}`,
        max_results: 10,
      }),
    }));
    if (!response.ok) return { evidence: "" };
    return { evidence: (await response.text()).slice(0, 16_000), provider: searchProfile.provider };
  } catch {
    return { evidence: "" };
  }
}

async function classifyBatch(classifier: SmartModelProfile, batch: SmartModelProfile[], evidence: string): Promise<Array<Record<string, unknown>>> {
  const compact = batch.map((profile) => ({
    modelKey: profile.modelKey,
    capabilities: profile.capabilities,
    inputPrice: profile.inputPrice,
    outputPrice: profile.outputPrice,
    deterministicQuality: profile.quality,
    deterministicTier: profile.recommendedTier,
  }));
  const prompt = [
    "You profile AI models for a production smart router. Return JSON only: an array with exactly one object per modelKey.",
    'Each object: {"modelKey":string,"quality":0..1,"latencyScore":0..1,"reliabilityScore":0..1,"recommendedTier":"simple|standard|complex|reasoning","needScores":object,"sources":string[]}.',
    "Do not change hard capabilities. Calibrate relative quality, speed, reliability, and task fit. Use only evidence supplied or well-established model-family facts. Put supporting URLs from evidence in sources; use [] if unsupported.",
    `Models: ${JSON.stringify(compact)}`,
    evidence ? `Web research evidence: ${evidence}` : "No web research provider was available; make conservative suggestions.",
  ].join("\n");
  const body: Record<string, unknown> = {
    model: classifier.modelKey,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 8_000,
    stream: false,
  };
  const rawRequest = {
    endpoint: "/v1/chat/completions",
    body,
    headers: { accept: "application/json", "x-router-internal": "profile-suggestion" },
  };
  const response = await handleSingleModelChat(body, classifier.modelKey, rawRequest, null, null);
  if (!response.ok) return [];
  return parseSuggestions(await response.json());
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const inventory = await refreshDeterministicSmartProfiles();
    const requestedKeys = Array.isArray(body.modelKeys)
      ? new Set(body.modelKeys.filter((key: unknown): key is string => typeof key === "string"))
      : null;
    const targets = inventory
      .filter((profile) => !requestedKeys || requestedKeys.has(profile.modelKey))
      .slice(0, MAX_PROFILES);
    if (targets.length === 0) return NextResponse.json({ error: "No active models selected" }, { status: 400 });
    const classifier = chooseClassifier(inventory, typeof body.classifierModel === "string" ? body.classifierModel : undefined);
    if (!classifier) return NextResponse.json({ error: "No active LLM is available to suggest profiles" }, { status: 409 });

    const research = body.webResearch === false ? { evidence: "" } : await researchInventory(request, targets);
    const suggestions: Array<Record<string, unknown>> = [];
    for (let offset = 0; offset < targets.length; offset += BATCH_SIZE) {
      suggestions.push(...await classifyBatch(classifier, targets.slice(offset, offset + BATCH_SIZE), research.evidence));
    }
    const suggestionByKey = new Map(suggestions.map((suggestion) => [String(suggestion.modelKey || ""), suggestion]));
    const preview = targets.map((profile) => ({ ...profile, ...(suggestionByKey.get(profile.modelKey) || {}), modelKey: profile.modelKey }));
    const researchedAt = new Date().toISOString();
    return NextResponse.json({
      profiles: preview,
      classifierModel: classifier.modelKey,
      researchedAt,
      researchProvider: research.provider || null,
      webResearchUsed: !!research.evidence,
      totalInventory: inventory.length,
      included: preview.length,
      truncated: targets.length < inventory.filter((profile) => !requestedKeys || requestedKeys.has(profile.modelKey)).length,
    });
  } catch (error) {
    console.error("Error suggesting smart model profiles:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to suggest model profiles" }, { status: 500 });
  }
}
