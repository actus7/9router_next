import { deriveModelName } from "./namePatterns";

// Normalize version separators in a model id: hyphen between two digits becomes a dot.
// Registry ids use dots for versions ("claude-sonnet-4.5") but clients (CLIs, aliases)
// often send them with dashes ("claude-sonnet-4-5"). Only digit-digit hyphens are
// touched, so word/suffix hyphens stay intact ("-thinking", "-agentic", "qwen3-coder-next").
export function normalizeModelId(modelId: string) {
  if (typeof modelId !== "string") return modelId;
  return modelId.replace(/(\d)-(\d)/g, "$1.$2");
}

// Model defaults centralized (was scattered as `m.kind || "llm"`, `quotaFamily || "normal"`, etc.)
export const MODEL_DEFAULTS = {
  kind: "llm",
  quotaFamily: "normal",
  strip: [],
  targetFormat: null
};

// Normalize a registry model entry: accept terse "id" string, fill name via regex when omitted.
// Override always wins (raw spread last); name falls back to regex → id.
export function normalizeModel(raw: string | Record<string, unknown>) {
  const model = typeof raw === "string" ? { id: raw } : raw;
  if (model.name !== undefined) return model;
  return { ...model, name: deriveModelName(model.id as string) };
}

// Resolve model kind with default (accepts legacy `type` field)
export function modelKind(model: Record<string, unknown> | undefined) {
  return (model?.kind as string) || (model?.type as string) || MODEL_DEFAULTS.kind;
}
export function modelQuotaFamily(model: Record<string, unknown> | undefined) {
  return (model?.quotaFamily as string) || MODEL_DEFAULTS.quotaFamily;
}
export function modelStrip(model: Record<string, unknown> | undefined) {
  return (model?.strip as string[]) || [];
}
export function modelTargetFormat(model: Record<string, unknown> | undefined) {
  return (model?.targetFormat as string | null) || MODEL_DEFAULTS.targetFormat;
}

// Per-model declared upstream formats (e.g. ["openai", "claude"]). Guards the
// sourceFormat-matched transport for multi-endpoint providers whose models differ
// in endpoint support (opencode-go: kimi/glm only do /chat/completions, minimax/qwen
// also do /messages, deepseek also does /responses).
export function modelSupportedFormats(model: Record<string, unknown> | undefined) {
  return model?.supportedFormats || null;
}
