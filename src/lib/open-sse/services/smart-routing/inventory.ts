import {
  getCustomModels,
  getProviderConnections,
  getSmartModelProfiles,
  upsertSmartModelProfiles,
} from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getModelsByProviderId } from "@/lib/open-sse/config/providerModels";
import { getCapabilitiesForModel } from "@/lib/open-sse/providers/capabilities";
import { getPricingForModel } from "@/lib/open-sse/providers/pricing";
import { AI_PROVIDERS, getProviderAlias, resolveProviderId } from "@/shared/constants/providers";
import type {
  RouteNeed,
  RoutingTier,
  RoutingTierOrDefault,
  SmartModelCapabilities,
  SmartModelProfile,
  SmartRoutingConfig,
} from "./types";

interface ProviderConnectionLike {
  provider: string;
  isActive?: boolean;
}

interface CustomModelLike {
  providerAlias?: string;
  provider?: string;
  id?: string;
  name?: string;
  type?: string;
  kind?: string;
  serviceKinds?: string[];
}

interface InventoryModel {
  providerId: string;
  providerAlias: string;
  model: string;
  displayName: string;
  serviceKinds: string[];
}

export interface RankedSmartCandidate {
  modelKey: string;
  tier: RoutingTier;
  degraded: boolean;
  source: SmartModelProfile["source"];
  score: number;
}

const TIER_ORDER: Record<RoutingTier, RoutingTier[]> = {
  simple: ["simple", "standard", "complex", "reasoning"],
  standard: ["standard", "complex", "reasoning", "simple"],
  complex: ["complex", "reasoning", "standard", "simple"],
  reasoning: ["reasoning", "complex", "standard", "simple"],
};

const TIER_INDEX: Record<RoutingTier, number> = { simple: 0, standard: 1, complex: 2, reasoning: 3 };

export function getSmartTierOrder(tier: RoutingTier): RoutingTier[] {
  return [...TIER_ORDER[tier]];
}

function stableFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeKinds(providerKinds: unknown, modelKind: unknown): string[] {
  const fromProvider = Array.isArray(providerKinds) ? providerKinds.filter((kind): kind is string => typeof kind === "string") : [];
  const fromModel = typeof modelKind === "string" ? [modelKind] : [];
  const values = [...fromModel, ...fromProvider];
  return [...new Set(values.length > 0 ? values : ["llm"])];
}

async function loadInventory(): Promise<InventoryModel[]> {
  const [connections, customModels, disabled] = await Promise.all([
    getProviderConnections({ isActive: true }) as Promise<ProviderConnectionLike[]>,
    getCustomModels() as Promise<CustomModelLike[]>,
    getDisabledModels(),
  ]);
  const activeProviders = new Set(connections.filter((connection) => connection.isActive !== false).map((connection) => connection.provider));
  for (const provider of Object.values(AI_PROVIDERS)) {
    if (provider.noAuth === true) activeProviders.add(provider.id as string);
  }

  const inventory: InventoryModel[] = [];
  const seen = new Set<string>();
  for (const providerId of activeProviders) {
    const provider = AI_PROVIDERS[providerId] || AI_PROVIDERS[resolveProviderId(providerId)];
    const alias = (provider?.alias as string) || getProviderAlias(providerId);
    const providerDisabled = new Set([...(disabled[alias] || []), ...(disabled[providerId] || [])]);
    const providerModels = getModelsByProviderId(providerId) as Array<Record<string, unknown>>;
    for (const entry of providerModels) {
      const model = String(entry.id || "");
      if (!model || providerDisabled.has(model)) continue;
      const modelKey = `${alias}/${model}`;
      if (seen.has(modelKey)) continue;
      seen.add(modelKey);
      inventory.push({
        providerId,
        providerAlias: alias,
        model,
        displayName: String(entry.name || model),
        serviceKinds: normalizeKinds(provider?.serviceKinds, entry.kind || entry.type),
      });
    }
    const providerKinds = normalizeKinds(provider?.serviceKinds, undefined);
    if (providerModels.length === 0 && providerKinds.some((kind) => kind !== "llm")) {
      const modelKey = `${alias}/${alias}`;
      if (!seen.has(modelKey)) {
        seen.add(modelKey);
        inventory.push({
          providerId,
          providerAlias: alias,
          model: alias,
          displayName: String(provider?.name || provider?.label || alias),
          serviceKinds: providerKinds,
        });
      }
    }
  }

  for (const custom of customModels) {
    const alias = custom.providerAlias || custom.provider;
    const model = custom.id;
    if (!alias || !model || (disabled[alias] || []).includes(model)) continue;
    const modelKey = `${alias}/${model}`;
    if (seen.has(modelKey)) continue;
    seen.add(modelKey);
    const providerId = resolveProviderId(alias);
    inventory.push({
      providerId,
      providerAlias: alias,
      model,
      displayName: custom.name || model,
      serviceKinds: normalizeKinds(custom.serviceKinds || AI_PROVIDERS[providerId]?.serviceKinds, custom.kind || custom.type),
    });
  }
  return inventory;
}

function numericPricing(pricing: Record<string, unknown> | null, keys: string[]): number | null {
  if (!pricing) return null;
  for (const key of keys) {
    const value = Number(pricing[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function profileQuality(model: string, caps: SmartModelCapabilities): number {
  const id = model.toLowerCase();
  let quality = 0.58;
  if (/(opus|pro|max|ultra|sonnet|gpt-5\.[4-9]|gpt-5-[4-9]|o[134](?:\b|-)|deepseek-r|reason)/.test(id)) quality += 0.22;
  if (/(mini|nano|flash|haiku|small|lite|luna|instant|turbo)/.test(id)) quality -= 0.13;
  if (caps.reasoning) quality += 0.08;
  if (caps.contextWindow >= 500_000) quality += 0.05;
  return Math.max(0.2, Math.min(0.98, quality));
}

function latencyScore(model: string): number {
  const id = model.toLowerCase();
  if (/(nano|flash|haiku|mini|small|lite|luna|instant|speed)/.test(id)) return 0.9;
  if (/(opus|pro|max|ultra|reason|thinking)/.test(id)) return 0.48;
  return 0.7;
}

function recommendedTier(model: string, quality: number, caps: SmartModelCapabilities): RoutingTier {
  const id = model.toLowerCase();
  if (caps.reasoning && (quality >= 0.82 || /(reason|thinking|o[134](?:\b|-))/.test(id))) return "reasoning";
  if (quality >= 0.8) return "complex";
  if (quality <= 0.55 || /(nano|mini|flash|haiku|small|lite|luna|instant)/.test(id)) return "simple";
  return "standard";
}

function buildNeedScores(model: string, caps: SmartModelCapabilities, kinds: string[]): Partial<Record<RouteNeed, number>> {
  const id = model.toLowerCase();
  return {
    general: 0.7,
    vision: caps.vision ? 0.9 : 0,
    tool_use: caps.tools ? 0.82 : 0,
    coding: /(code|codex|coder|dev|qwen|deepseek)/.test(id) ? 0.95 : caps.tools ? 0.65 : 0.45,
    data_analysis: caps.tools ? 0.78 : 0.58,
    web_search: kinds.includes("webSearch") || caps.search ? 0.92 : 0,
    web_fetch: kinds.includes("webFetch") || caps.search ? 0.88 : 0,
    image_generation: kinds.includes("image") || caps.imageOutput ? 0.95 : 0,
    video_generation: kinds.includes("video") ? 0.95 : 0,
    tts: kinds.includes("tts") || caps.audioOutput ? 0.95 : 0,
    stt: kinds.includes("stt") || caps.audioInput ? 0.95 : 0,
    embeddings: kinds.includes("embedding") ? 0.95 : 0,
    email_management: caps.tools ? 0.72 : 0.4,
    calendar_management: caps.tools ? 0.72 : 0.4,
    social_media: 0.65,
    trading: caps.reasoning ? 0.78 : 0.55,
  };
}

function deterministicProfile(item: InventoryModel): SmartModelProfile {
  const rawCaps = getCapabilitiesForModel(item.providerAlias, item.model) as Record<string, unknown>;
  const capabilities: SmartModelCapabilities = {
    serviceKinds: item.serviceKinds,
    vision: rawCaps.vision === true,
    pdf: rawCaps.pdf === true,
    audioInput: rawCaps.audioInput === true,
    videoInput: rawCaps.videoInput === true,
    imageOutput: rawCaps.imageOutput === true,
    audioOutput: rawCaps.audioOutput === true,
    tools: rawCaps.tools !== false,
    search: rawCaps.search === true,
    reasoning: rawCaps.reasoning === true,
    contextWindow: Number(rawCaps.contextWindow) || 0,
    maxOutput: Number(rawCaps.maxOutput) || 0,
  };
  const pricing = getPricingForModel(item.providerAlias, item.model) as Record<string, unknown> | null;
  const quality = profileQuality(item.model, capabilities);
  const fingerprint = stableFingerprint(JSON.stringify({
    provider: item.providerId,
    alias: item.providerAlias,
    model: item.model,
    kinds: item.serviceKinds,
    capabilities,
    pricing,
  }));
  return {
    modelKey: `${item.providerAlias}/${item.model}`,
    provider: item.providerAlias,
    model: item.model,
    displayName: item.displayName,
    capabilities,
    inputPrice: numericPricing(pricing, ["input", "prompt"]),
    outputPrice: numericPricing(pricing, ["output", "completion"]),
    quality,
    latencyScore: latencyScore(item.model),
    reliabilityScore: 0.72,
    recommendedTier: recommendedTier(item.model, quality, capabilities),
    needScores: buildNeedScores(item.model, capabilities, item.serviceKinds),
    source: "deterministic",
    inventoryFingerprint: fingerprint,
    sources: [],
  };
}

export async function refreshDeterministicSmartProfiles(persist = false): Promise<SmartModelProfile[]> {
  const inventory = await loadInventory();
  const deterministic = inventory.map(deterministicProfile);
  const persisted = await getSmartModelProfiles();
  const storedByKey = new Map(persisted.map((profile) => [profile.modelKey, profile]));
  const profiles = deterministic.map((base) => {
    const stored = storedByKey.get(base.modelKey);
    if (!stored || stored.inventoryFingerprint !== base.inventoryFingerprint || stored.source === "deterministic") return base;
    return {
      ...base,
      ...stored,
      capabilities: { ...base.capabilities, ...stored.capabilities, serviceKinds: base.capabilities.serviceKinds },
      inventoryFingerprint: base.inventoryFingerprint,
    };
  });
  if (persist) await upsertSmartModelProfiles(profiles);
  return profiles;
}

function isEligible(profile: SmartModelProfile, need: RouteNeed, tokenEstimate = 0): boolean {
  const caps = profile.capabilities;
  if (tokenEstimate > 0 && caps.contextWindow > 0 && caps.contextWindow < tokenEstimate) return false;
  switch (need) {
    case "vision": return caps.vision;
    case "tool_use": return caps.tools;
    case "web_search": return caps.serviceKinds.includes("webSearch") || caps.search;
    case "web_fetch": return caps.serviceKinds.includes("webFetch") || caps.search;
    case "image_generation": return caps.serviceKinds.includes("image") || caps.imageOutput;
    case "video_generation": return caps.serviceKinds.includes("video");
    case "tts": return caps.serviceKinds.includes("tts") || caps.audioOutput;
    case "stt": return caps.serviceKinds.includes("stt") || caps.audioInput;
    case "embeddings": return caps.serviceKinds.includes("embedding");
    default: return caps.serviceKinds.includes("llm");
  }
}

function priceScore(profile: SmartModelProfile): number {
  if (profile.inputPrice === null && profile.outputPrice === null) return 0.5;
  const blended = (profile.inputPrice || 0) + (profile.outputPrice || 0) * 0.4;
  return 1 / (1 + Math.max(0, blended) / 5);
}

function rankScore(profile: SmartModelProfile, need: RouteNeed, requestedTier: RoutingTier): number {
  const needScore = profile.needScores[need] ?? profile.needScores.general ?? 0.5;
  const distance = Math.abs(TIER_INDEX[profile.recommendedTier] - TIER_INDEX[requestedTier]);
  const tierFit = Math.max(0, 1 - distance * 0.28);
  const economyWeight = requestedTier === "simple" ? 0.25 : requestedTier === "standard" ? 0.14 : 0.05;
  return needScore * 0.34
    + profile.quality * 0.25
    + tierFit * 0.2
    + profile.reliabilityScore * 0.11
    + profile.latencyScore * (0.1 - economyWeight / 3)
    + priceScore(profile) * economyWeight;
}

export function rankSmartProfiles(
  profiles: SmartModelProfile[],
  need: RouteNeed,
  requestedTier: RoutingTier,
  config: SmartRoutingConfig,
  tokenEstimate = 0,
): RankedSmartCandidate[] {
  const eligible = profiles.filter((profile) => isEligible(profile, need, tokenEstimate));
  const profileByKey = new Map(eligible.map((profile) => [profile.modelKey, profile]));
  const result: RankedSmartCandidate[] = [];
  const seen = new Set<string>();
  const tierOrder = getSmartTierOrder(requestedTier);

  for (const tier of tierOrder) {
    const overrideKeys = [
      ...(config.overrides[need]?.[tier] || []),
      ...(config.overrides[need]?.default || []),
    ];
    for (const modelKey of overrideKeys) {
      const profile = profileByKey.get(modelKey);
      if (!profile || seen.has(modelKey)) continue;
      seen.add(modelKey);
      result.push({ modelKey, tier, degraded: TIER_INDEX[tier] < TIER_INDEX[requestedTier], source: "manual", score: 2 });
    }

    const dynamic = eligible
      .filter((profile) => profile.recommendedTier === tier && !seen.has(profile.modelKey))
      .map((profile) => ({ profile, score: rankScore(profile, need, requestedTier) }))
      .sort((a, b) => b.score - a.score || a.profile.modelKey.localeCompare(b.profile.modelKey));
    for (const item of dynamic) {
      seen.add(item.profile.modelKey);
      result.push({
        modelKey: item.profile.modelKey,
        tier,
        degraded: TIER_INDEX[tier] < TIER_INDEX[requestedTier],
        source: item.profile.source,
        score: Number(item.score.toFixed(4)),
      });
    }
  }
  return result;
}

export function resolveRequestedTier(tier: RoutingTierOrDefault, assessedTier: RoutingTier): RoutingTier {
  return tier === "default" ? assessedTier : tier;
}
