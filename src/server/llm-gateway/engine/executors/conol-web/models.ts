// Conol model/effort resolution — fallback catalog + effort-ladder clamping.
// Ported from OmniRoute's conolModels.ts, dropping discoverConolModels /
// parseConolAgentServers: the live discovery endpoint is never called from
// the actual chat-turn flow (only the fallback catalog is), so this keeps
// just what execute() needs.

export type ConolEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export const CONOL_EFFORT_ORDER: readonly ConolEffort[] = ["minimal", "low", "medium", "high", "xhigh"];

export interface ConolModel {
  id: string;
  name: string;
  supportsVision?: boolean;
  efforts?: ConolEffort[];
}

const EFFORTS_XHIGH: ConolEffort[] = ["low", "medium", "high", "xhigh"];
const EFFORTS_STANDARD: ConolEffort[] = ["minimal", "low", "medium", "high"];
const EFFORTS_NO_XHIGH: ConolEffort[] = ["low", "medium", "high"];
const EFFORTS_HIGH_ONLY: ConolEffort[] = ["high", "xhigh"];
const EFFORTS_PRO: ConolEffort[] = ["medium", "high", "xhigh"];

interface FallbackModelSeed {
  id: string;
  vision: boolean;
  efforts: ConolEffort[];
}

const FALLBACK_MODEL_SEEDS: FallbackModelSeed[] = [
  { id: "claude-opus-5", vision: true, efforts: EFFORTS_XHIGH },
  { id: "claude-opus-4-8", vision: true, efforts: EFFORTS_XHIGH },
  { id: "claude-fable-5", vision: true, efforts: EFFORTS_XHIGH },
  { id: "claude-sonnet-5", vision: true, efforts: EFFORTS_NO_XHIGH },
  { id: "claude-sonnet-4-6", vision: true, efforts: EFFORTS_NO_XHIGH },
  { id: "claude-haiku-4-5", vision: true, efforts: EFFORTS_STANDARD },
  { id: "gpt-5.5", vision: true, efforts: EFFORTS_XHIGH },
  { id: "gpt-5.5-pro", vision: true, efforts: EFFORTS_PRO },
  { id: "gpt-5.6-sol", vision: true, efforts: EFFORTS_XHIGH },
  { id: "gpt-5.6-terra", vision: true, efforts: EFFORTS_XHIGH },
  { id: "gpt-5.6-luna", vision: true, efforts: EFFORTS_XHIGH },
  { id: "deepseek/deepseek-v4-pro", vision: false, efforts: EFFORTS_HIGH_ONLY },
  { id: "openrouter/fusion", vision: false, efforts: [] },
  { id: "z-ai/glm-5.2", vision: false, efforts: EFFORTS_STANDARD },
  { id: "tencent/hy3", vision: false, efforts: EFFORTS_STANDARD },
  { id: "moonshotai/kimi-k3", vision: true, efforts: EFFORTS_STANDARD },
  { id: "moonshotai/kimi-k2.7-code", vision: true, efforts: EFFORTS_STANDARD },
  { id: "qwen/qwen3.7-plus", vision: true, efforts: EFFORTS_STANDARD },
  { id: "qwen/qwen3.7-max", vision: false, efforts: EFFORTS_STANDARD },
  { id: "minimax/minimax-m3", vision: true, efforts: EFFORTS_STANDARD },
  { id: "stepfun/step-3.7-flash", vision: true, efforts: EFFORTS_STANDARD },
  { id: "google/gemini-3.7-flash", vision: true, efforts: EFFORTS_STANDARD },
  { id: "google/gemini-3.1-pro-preview", vision: true, efforts: EFFORTS_STANDARD },
  { id: "google/gemini-3.1-flash-lite", vision: true, efforts: EFFORTS_STANDARD },
  { id: "x-ai/grok-4.3", vision: true, efforts: EFFORTS_STANDARD },
  { id: "deepseek/deepseek-v4-flash", vision: false, efforts: EFFORTS_HIGH_ONLY },
  { id: "xiaomi/mimo-v2.5", vision: true, efforts: EFFORTS_STANDARD },
  { id: "xiaomi/mimo-v2.5-pro", vision: false, efforts: EFFORTS_STANDARD },
];

function modelName(id: string): string {
  return id.split("/").pop()!.split("-").map((part) => {
    const lower = part.toLowerCase();
    if (["gpt", "ai", "glm"].includes(lower)) return lower.toUpperCase();
    return part.length ? part[0]!.toUpperCase() + part.slice(1) : part;
  }).join(" ");
}

export const CONOL_FALLBACK_MODELS: ConolModel[] = FALLBACK_MODEL_SEEDS.map((seed) => ({
  id: seed.id, name: modelName(seed.id), supportsVision: seed.vision, efforts: [...seed.efforts],
}));

const CONOL_FALLBACK_EFFORTS = new Map<string, ConolEffort[]>(FALLBACK_MODEL_SEEDS.map((seed) => [seed.id, seed.efforts]));

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Clamp a requested effort onto the ladder a model actually advertises. */
export function clampConolEffort(requested: ConolEffort, supported: readonly ConolEffort[] | undefined): ConolEffort | null {
  const ladder = supported && supported.length ? CONOL_EFFORT_ORDER.filter((effort) => supported.includes(effort)) : [];
  if (!ladder.length) return null;
  if (ladder.includes(requested)) return requested;
  const requestedRank = CONOL_EFFORT_ORDER.indexOf(requested);
  let below: ConolEffort | null = null;
  for (const effort of ladder) {
    if (CONOL_EFFORT_ORDER.indexOf(effort) <= requestedRank) below = effort;
  }
  return below ?? ladder[0]!;
}

export function conolEffortsForModel(modelId: string): ConolEffort[] {
  return [...(CONOL_FALLBACK_EFFORTS.get(modelId) ?? [])];
}

export const CONOL_DEFAULT_EFFORT: ConolEffort = "xhigh";

export function resolveConolModelSelection(value: unknown): { model: string; effort: ConolEffort; effortExplicit: boolean } {
  let model = readString(value);
  if (model.startsWith("conol-web/")) model = model.slice("conol-web/".length);
  else if (model.startsWith("conol/")) model = model.slice("conol/".length);
  else if (model.startsWith("cnl/")) model = model.slice("cnl/".length);
  model ||= "claude-sonnet-5";

  const effortMatch = model.match(/-(xhigh|high|medium|low|minimal)$/);
  if (!effortMatch) return { model, effort: CONOL_DEFAULT_EFFORT, effortExplicit: false };
  return { model: model.slice(0, -effortMatch[0].length), effort: effortMatch[1] as ConolEffort, effortExplicit: true };
}
