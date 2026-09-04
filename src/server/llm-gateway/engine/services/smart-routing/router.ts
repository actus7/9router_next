import { FREE_DEFAULT_MODEL_KEY } from "../../host/catalog";
import { getComboByName } from "../../host/store";
import { ROUTE_NEEDS, ROUTING_TIERS, DEFAULT_SMART_ROUTING_CONFIG } from "./types";
import { rankSmartProfilesForEndpoint, refreshDeterministicSmartProfiles, resolveRequestedTier, getSmartTierOrder } from "./inventory";
import { recordRoutingTier, scoreRoutingRequest } from "./scoring";
import type {
  RouteNeed,
  RoutingDecisionMeta,
  RoutingTier,
  RoutingTierOrDefault,
  SmartComboEntry,
  SmartRoutingConfig,
} from "./types";

export interface LlmRoutingClassification {
  tier: RoutingTier;
  need?: RouteNeed;
}

export interface ResolveSmartRoutingOptions {
  combo: SmartComboEntry;
  body: Record<string, unknown>;
  headers?: Headers | Record<string, string | undefined> | null;
  endpointNeed?: RouteNeed;
  sessionKey?: string;
  classifyWithModel?: (model: string, prompt: string, timeoutMs: number) => Promise<LlmRoutingClassification | null>;
}

export interface SmartRoutingResolution {
  models: string[];
  meta: RoutingDecisionMeta;
  config: SmartRoutingConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

export function normalizeSmartRoutingConfig(value: unknown): SmartRoutingConfig {
  const input = isRecord(value) ? value : {};
  const complexity = isRecord(input.complexity) ? input.complexity : {};
  const task = isRecord(input.task) ? input.task : {};
  const classifier = isRecord(input.classifier) ? input.classifier : {};
  const rawOverrides = isRecord(input.overrides) ? input.overrides : {};
  const overrides: SmartRoutingConfig["overrides"] = {};
  for (const need of ROUTE_NEEDS) {
    const rawNeed = isRecord(rawOverrides[need]) ? rawOverrides[need] as Record<string, unknown> : null;
    if (!rawNeed) continue;
    const next: Partial<Record<RoutingTierOrDefault, string[]>> = {};
    for (const tier of ["default", ...ROUTING_TIERS] as RoutingTierOrDefault[]) {
      if (Array.isArray(rawNeed[tier])) {
        next[tier] = [...new Set((rawNeed[tier] as unknown[]).filter((model): model is string => typeof model === "string" && model.includes("/")))];
      }
    }
    if (Object.keys(next).length > 0) overrides[need] = next;
  }
  return {
    version: 1,
    complexity: { enabled: complexity.enabled !== false },
    task: {
      enabled: task.enabled !== false,
      confidenceThreshold: clamp(task.confidenceThreshold, DEFAULT_SMART_ROUTING_CONFIG.task.confidenceThreshold, 0, 1),
    },
    classifier: {
      enabled: classifier.enabled !== false,
      confidenceThreshold: clamp(classifier.confidenceThreshold, DEFAULT_SMART_ROUTING_CONFIG.classifier.confidenceThreshold, 0, 1),
      timeoutMs: Math.round(clamp(classifier.timeoutMs, DEFAULT_SMART_ROUTING_CONFIG.classifier.timeoutMs, 250, 30_000)),
      model: typeof classifier.model === "string" && classifier.model.trim() ? classifier.model.trim() : "auto",
    },
    overrides,
  };
}

export function validateSmartRoutingConfig(value: unknown): { ok: true; config: SmartRoutingConfig } | { ok: false; error: string } {
  if (value !== undefined && value !== null && !isRecord(value)) return { ok: false, error: "routing must be an object" };
  const input = isRecord(value) ? value : {};
  if (input.version !== undefined && input.version !== 1) return { ok: false, error: "Unsupported routing config version" };
  if (input.classifier !== undefined && !isRecord(input.classifier)) return { ok: false, error: "routing.classifier must be an object" };
  if (isRecord(input.classifier)) {
    const threshold = input.classifier.confidenceThreshold;
    if (threshold !== undefined && (!Number.isFinite(Number(threshold)) || Number(threshold) < 0 || Number(threshold) > 1)) {
      return { ok: false, error: "routing.classifier.confidenceThreshold must be between 0 and 1" };
    }
  }
  if (input.overrides !== undefined && !isRecord(input.overrides)) return { ok: false, error: "routing.overrides must be an object" };
  return { ok: true, config: normalizeSmartRoutingConfig(value) };
}

function getHeader(headers: ResolveSmartRoutingOptions["headers"], name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  const lowered = name.toLowerCase();
  return headers[lowered] || headers[name] || null;
}

export function parseRoutingTierHeader(headers: ResolveSmartRoutingOptions["headers"]): { tier: RoutingTierOrDefault | null; error?: string } {
  const value = getHeader(headers, "x-router-tier")?.trim().toLowerCase();
  if (!value) return { tier: null };
  if (value === "default" || ROUTING_TIERS.includes(value as RoutingTier)) return { tier: value as RoutingTierOrDefault };
  return { tier: null, error: `Invalid x-router-tier: ${value}. Expected default, simple, standard, complex, or reasoning.` };
}

function classifierPrompt(text: string, endpointNeed: RouteNeed): string {
  return [
    "You are a routing classifier. Return JSON only, with no markdown.",
    'Schema: {"tier":"simple|standard|complex|reasoning","need":"general|vision|tool_use|coding|data_analysis|web_search|web_fetch|image_generation|video_generation|tts|stt|embeddings|email_management|calendar_management|social_media|trading"}',
    "Classify required reasoning complexity, not writing length. Prefer the least expensive tier that can reliably complete the request.",
    `Endpoint need: ${endpointNeed}`,
    `Request: ${text.slice(0, 12_000)}`,
  ].join("\n");
}

function chooseClassifierModel(config: SmartRoutingConfig, profiles: Awaited<ReturnType<typeof refreshDeterministicSmartProfiles>>): string | null {
  if (config.classifier.model !== "auto") {
    return profiles.some((profile) => profile.modelKey === config.classifier.model && profile.capabilities.serviceKinds.includes("llm"))
      ? config.classifier.model
      : null;
  }
  const llmProfiles = profiles.filter((profile) => profile.capabilities.serviceKinds.includes("llm"));

  // "auto" used to mean "the best model available", which is backwards for a
  // classifier: it runs on every ambiguous request, only has to pick a tier
  // from a fixed list, and spending the strongest (usually most expensive)
  // model on that is waste. The credential-free default is cheap and needs no
  // account, so it is also the only candidate on a fresh install — without it
  // an unconfigured instance had no classifier at all, and every ambiguous
  // request fell through as "ambiguous".
  const freeDefault = llmProfiles.find((profile) => profile.modelKey === FREE_DEFAULT_MODEL_KEY);
  if (freeDefault) return freeDefault.modelKey;

  return llmProfiles
    .sort((a, b) => {
      const aScore = a.quality * 0.65 + a.reliabilityScore * 0.2 + a.latencyScore * 0.15;
      const bScore = b.quality * 0.65 + b.reliabilityScore * 0.2 + b.latencyScore * 0.15;
      return bScore - aScore || a.modelKey.localeCompare(b.modelKey);
    })[0]?.modelKey || null;
}

function mergeLegacyModels(config: SmartRoutingConfig, need: RouteNeed, models: string[]): SmartRoutingConfig {
  if (models.length === 0) return config;
  return {
    ...config,
    overrides: {
      ...config.overrides,
      [need]: {
        ...config.overrides[need],
        default: [...new Set([...models, ...(config.overrides[need]?.default || [])])],
      },
    },
  };
}

export async function resolveSmartRouting(options: ResolveSmartRoutingOptions): Promise<SmartRoutingResolution> {
  const endpointNeed = options.endpointNeed || "general";
  const assessment = scoreRoutingRequest(options.body, endpointNeed, options.sessionKey);
  const header = parseRoutingTierHeader(options.headers);
  if (header.error) throw new Error(header.error);

  let config = normalizeSmartRoutingConfig(options.combo.routing);
  let chosenTier = config.complexity.enabled ? assessment.tier : "standard";
  let chosenNeed = config.task.enabled && assessment.needConfidence >= config.task.confidenceThreshold
    ? assessment.need
    : endpointNeed;
  let reason = assessment.reason;
  let classifierModel: string | undefined;
  let classifierLatencyMs: number | undefined;
  const profiles = await refreshDeterministicSmartProfiles();

  if (assessment.confidence < config.classifier.confidenceThreshold && config.classifier.enabled && options.classifyWithModel) {
    const model = chooseClassifierModel(config, profiles);
    if (model) {
      const startedAt = Date.now();
      classifierModel = model;
      try {
        const classification = await options.classifyWithModel(
          model,
          classifierPrompt(assessment.signals.lastUserText, options.endpointNeed || "general"),
          config.classifier.timeoutMs,
        );
        classifierLatencyMs = Date.now() - startedAt;
        if (classification && ROUTING_TIERS.includes(classification.tier)) {
          chosenTier = classification.tier;
          if (classification.need && ROUTE_NEEDS.includes(classification.need)) chosenNeed = classification.need;
          reason = "llm_classifier";
        } else {
          reason = "ambiguous";
        }
      } catch {
        classifierLatencyMs = Date.now() - startedAt;
        reason = "ambiguous";
      }
    }
  } else if (assessment.confidence < config.classifier.confidenceThreshold) {
    reason = "ambiguous";
  }

  if (header.tier) {
    chosenTier = resolveRequestedTier(header.tier, chosenTier);
    reason = "header_override";
  }

  config = mergeLegacyModels(config, chosenNeed, options.combo.models || []);
  config = mergeLegacyModels(config, endpointNeed, options.combo.models || []);
  const ranking = rankSmartProfilesForEndpoint({
    profiles,
    need: chosenNeed,
    endpointNeed,
    requestedTier: chosenTier,
    config,
    tokenEstimate: assessment.signals.tokenEstimate,
  });
  const ranked = ranking.candidates;
  if (ranking.fellBackToEndpointNeed) {
    chosenNeed = ranking.need;
    reason = "endpoint";
  }
  const selected = ranked[0];
  const sourceSet = new Set(ranked.map((candidate) => candidate.source));
  const meta: RoutingDecisionMeta = {
    comboName: options.combo.name,
    need: chosenNeed,
    tier: chosenTier,
    score: assessment.score,
    confidence: assessment.confidence,
    reason,
    degraded: selected?.degraded || false,
    tierOrder: getSmartTierOrder(chosenTier),
    candidates: ranked.map((candidate) => candidate.modelKey),
    candidateDetails: ranked.map((candidate) => ({ model: candidate.modelKey, tier: candidate.tier, degraded: candidate.degraded, source: candidate.source })),
    classifierModel,
    classifierLatencyMs,
    profileSources: [...sourceSet],
  };
  recordRoutingTier(options.sessionKey, chosenTier);
  return { models: meta.candidates, meta, config };
}

export async function getSmartCombo(modelStr: string): Promise<SmartComboEntry | null> {
  if (!modelStr || modelStr.includes("/")) return null;
  const combo = await getComboByName(modelStr);
  if (!combo || combo.kind !== "smart") return null;
  return {
    id: combo.id,
    name: combo.name,
    kind: combo.kind,
    models: (combo.models || []).filter((model): model is string => typeof model === "string"),
    routing: normalizeSmartRoutingConfig(combo.routing),
  };
}

export const __test__ = { chooseClassifierModel };

export function deriveRoutingSessionKey(headers: Headers, body: Record<string, unknown>): string | undefined {
  const candidates = [
    headers.get("x-session-id"),
    headers.get("x-conversation-id"),
    headers.get("x-thread-id"),
    typeof body.session_id === "string" ? body.session_id : null,
    typeof body.conversation_id === "string" ? body.conversation_id : null,
    typeof body.user === "string" ? body.user : null,
  ];
  const value = candidates.find((candidate) => candidate && candidate.trim());
  return value?.trim();
}
